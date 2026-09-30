// ===========================================================================
// SERVIÇO DE AUTENTICAÇÃO — OdontoCare
// ===========================================================================
//
// RESPONSABILIDADES
// - Login (verificar credenciais, criar sessão)
// - Logout (invalidar sessão)
// - Recuperar sessão a partir do cookie HTTP-only
// - Verificar permissões (RBAC básico por role)
// - Hash de senha com bcryptjs
//
// SESSÃO:
//   Utiliza um token JWT-like armazenado em cookie HTTP-only (secure em
//   produção). O token contém: userId, username, role, professionalId.
//   A sessão é stateless (não há armazenamento no banco), mas o cookie
//   é configurado como HTTP-only + SameSite=Strict + Secure (em prod).
//
// SEGURANÇA:
//   - Senha nunca retornada em nenhum endpoint.
//   - passwordHash nunca exposto ao frontend.
//   - Mensagem de erro genérica (não informa se usuário existe).
//   - Usuário inativo impede login.
//   - Token assinado com segredo da aplicação.
// ===========================================================================

import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const SESSION_COOKIE_NAME = "odontocare_session"
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60 // 8 horas
const BCRYPT_ROUNDS = 10

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string
  username: string
  role: string
  active: boolean
  professionalId: string | null
  professionalName: string | null
  professionalCouncil: string | null
}

export interface SessionPayload {
  userId: string
  username: string
  role: string
  professionalId: string | null
  professionalName: string | null
  professionalCouncil: string | null
  iat: number
  exp: number
}

export interface LoginResult {
  success: boolean
  error?: string
  user?: AuthUser
}

// ---------------------------------------------------------------------------
// Utilitário: Token signing/verification
// ---------------------------------------------------------------------------

function getSecretKey(): string {
  const secret = process.env.AUTH_SECRET
  if (secret && secret.trim().length > 0) return secret

  // Em PRODUÇÃO, ausência de AUTH_SECRET é um erro fatal de configuração:
  // assinar sessões com um segredo público permitiria forjar cookies de login.
  // Falhar aqui (em vez de usar o fallback) evita subir produção insegura.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET não configurado. Defina um segredo forte nas variáveis de ambiente antes de iniciar em produção."
    )
  }

  // Fallback APENAS para desenvolvimento local.
  return "odontocare-dev-secret-key-nao-usar-em-producao"
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, "+").replace(/_/g, "/")
  while (str.length % 4) str += "="
  return Buffer.from(str, "base64").toString("utf-8")
}

async function signToken(payload: Omit<SessionPayload, "iat" | "exp">): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: SessionPayload = {
    ...payload,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  }

  const header = { alg: "HS256", typ: "JWT" }
  const headerEncoded = base64UrlEncode(JSON.stringify(header))
  const payloadEncoded = base64UrlEncode(JSON.stringify(fullPayload))

  const signature = base64UrlEncode(
    await cryptoSign(`${headerEncoded}.${payloadEncoded}`, getSecretKey())
  )

  return `${headerEncoded}.${payloadEncoded}.${signature}`
}

async function verifyToken(token: string): Promise<SessionPayload | null> {
  const parts = token.split(".")
  if (parts.length !== 3) return null

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts

  // Verify signature
  const expectedSignature = base64UrlEncode(
    await cryptoSign(`${headerEncoded}.${payloadEncoded}`, getSecretKey())
  )

  if (signatureEncoded !== expectedSignature) return null

  try {
    const payload: SessionPayload = JSON.parse(base64UrlDecode(payloadEncoded))

    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    return payload
  } catch {
    return null
  }
}

async function cryptoSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))
  return Buffer.from(signature).toString("base64")
}

// ---------------------------------------------------------------------------
// Hash de senha
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(
  username: string,
  password: string
): Promise<LoginResult> {
  if (!username || !username.trim()) {
    return { success: false, error: "Credenciais inválidas." }
  }
  if (!password) {
    return { success: false, error: "Credenciais inválidas." }
  }

  const user = await prisma.user.findUnique({
    where: { username: username.trim().toLowerCase() },
    include: {
      professional: {
        select: {
          id: true,
          fullName: true,
          councilType: true,
          councilNumber: true,
          councilState: true,
        },
      },
    },
  })

  // Mensagem genérica: não revela se o usuário existe
  if (!user) {
    return { success: false, error: "Credenciais inválidas." }
  }

  // Usuário inativo
  if (!user.active) {
    return { success: false, error: "Credenciais inválidas." }
  }

  const passwordValid = await verifyPassword(password, user.passwordHash)
  if (!passwordValid) {
    return { success: false, error: "Credenciais inválidas." }
  }

  // Atualizar lastLoginAt
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  // Montar dados do profissional associado
  let professionalName: string | null = null
  let professionalCouncil: string | null = null

  if (user.professional) {
    professionalName = user.professional.fullName
    professionalCouncil = `${user.professional.councilType}-${user.professional.councilState || "BR"} ${user.professional.councilNumber}`
  }

  const authUser: AuthUser = {
    id: user.id,
    username: user.username,
    role: user.role,
    active: user.active,
    professionalId: user.professionalId,
    professionalName,
    professionalCouncil,
  }

  return { success: true, user: authUser }
}

// ---------------------------------------------------------------------------
// Sessão (cookie)
// ---------------------------------------------------------------------------

export async function createSession(user: AuthUser): Promise<string> {
  const token = await signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    professionalId: user.professionalId,
    professionalName: user.professionalName,
    professionalCouncil: user.professionalCouncil,
  })

  return token
}

export async function getSession(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value

    if (!token) return null

    const payload = await verifyToken(token)
    if (!payload) return null

    // Verificar se o usuário ainda está ativo no banco
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        professionalId: true,
        professional: {
          select: {
            fullName: true,
            councilType: true,
            councilNumber: true,
            councilState: true,
          },
        },
      },
    })

    if (!user || !user.active) return null

    let professionalName: string | null = null
    let professionalCouncil: string | null = null

    if (user.professional) {
      professionalName = user.professional.fullName
      professionalCouncil = `${user.professional.councilType}-${user.professional.councilState || "BR"} ${user.professional.councilNumber}`
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      active: user.active,
      professionalId: user.professionalId,
      professionalName,
      professionalCouncil,
    }
  } catch {
    return null
  }
}

export async function destroySession(): Promise<void> {
  // Apenas remove o cookie — token stateless não precisa de invalidação no banco
}

// ---------------------------------------------------------------------------
// Cookie helpers (server-side)
// ---------------------------------------------------------------------------

export function getSessionCookieOptions(token: string): {
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  sameSite: "strict" | "lax"
  maxAge: number
  path: string
} {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  }
}

export function getLogoutCookieOptions(): {
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  sameSite: "strict" | "lax"
  maxAge: number
  path: string
} {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  }
}

// ---------------------------------------------------------------------------
// Autorização (RBAC simplificado)
// ---------------------------------------------------------------------------

// Definição de permissões por módulo
export type ModulePermission = "read" | "write" | "delete" | "admin"

// Perfis e suas permissões
const ROLE_PERMISSIONS: Record<string, Record<string, ModulePermission[]>> = {
  ADMINISTRADOR: {
    agenda: ["read", "write", "delete", "admin"],
    pacientes: ["read", "write", "delete", "admin"],
    procedimentos: ["read", "write", "delete", "admin"],
    atendimento: ["read", "write", "delete", "admin"],
    financeiro: ["read", "write", "delete", "admin"],
    configuracoes: ["read", "write", "delete", "admin"],
  },
  DENTISTA: {
    agenda: ["read", "write", "admin"],
    pacientes: ["read", "write"],
    procedimentos: ["read", "write"],
    atendimento: ["read", "write", "admin"],
    financeiro: ["read"],
    configuracoes: ["read"],
  },
  RECEPCAO: {
    agenda: ["read", "write"],
    pacientes: ["read", "write"],
    procedimentos: ["read"],
    atendimento: ["read"],
    financeiro: ["read"],
    configuracoes: [],
  },
}

export function hasPermission(
  role: string,
  module: string,
  action: ModulePermission
): boolean {
  const permissions = ROLE_PERMISSIONS[role]
  if (!permissions) return false

  const modulePerms = permissions[module]
  if (!modulePerms) return false

  return modulePerms.includes(action)
}

export function getRolePermissions(role: string): Record<string, ModulePermission[]> {
  return ROLE_PERMISSIONS[role] || {}
}

// ---------------------------------------------------------------------------
// Helpers para resolver o profissional autenticado
// ---------------------------------------------------------------------------

export interface AuthenticatedActor {
  userId: string | null
  name: string
  professionalCouncil: string | null
}

/**
 * Obtém o actor autenticado a partir da sessão atual.
 * Usado no backend para identificar quem está executando a ação.
 */
export async function getAuthenticatedActor(): Promise<AuthenticatedActor | null> {
  const session = await getSession()
  if (!session) return null

  return {
    userId: session.id,
    name: session.professionalName || session.username,
    professionalCouncil: session.professionalCouncil,
  }
}
import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { OAuth2Client } from "google-auth-library"
import { prisma } from "@/lib/prisma"
import {
  createSession,
  getSessionCookieOptions,
  type AuthUser,
} from "@/lib/auth-service"

export const dynamic = "force-dynamic"

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

async function ensureGoogleUser(email: string) {
  const normalizedEmail = email.trim().toLowerCase()

  let user = await prisma.user.findUnique({
    where: { username: normalizedEmail },
  })

  if (!user) {
    const generatedPassword = `google-${crypto.randomUUID()}`

    user = await prisma.user.create({
      data: {
        username: normalizedEmail,
        passwordHash: await bcrypt.hash(generatedPassword, 10),
        role: "DENTISTA",
        active: true,
      },
    })
  }

  return user
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const credential = typeof body?.credential === "string" ? body.credential : ""

    if (!credential) {
      return NextResponse.json(
        { error: "Credencial do Google ausente." },
        { status: 400 }
      )
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId) {
      return NextResponse.json(
        { error: "Google OAuth não configurado no servidor." },
        { status: 500 }
      )
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientId,
    })

    const payload = ticket.getPayload()
    if (!payload?.email) {
      return NextResponse.json(
        { error: "Não foi possível obter o e-mail do Google." },
        { status: 401 }
      )
    }

    const user = await ensureGoogleUser(payload.email)

    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      active: user.active,
      professionalId: user.professionalId,
      professionalName: null,
      professionalCouncil: null,
    }

    const token = await createSession(authUser)
    const cookieOptions = getSessionCookieOptions(token)

    const response = NextResponse.json(
      {
        user: {
          id: authUser.id,
          username: authUser.username,
          role: authUser.role,
          professionalId: authUser.professionalId,
          professionalName: authUser.professionalName,
          professionalCouncil: authUser.professionalCouncil,
        },
      },
      { status: 200 }
    )

    response.cookies.set(cookieOptions)
    return response
  } catch (error) {
    console.error("Erro no login com Google:", error)
    return NextResponse.json(
      { error: "Não foi possível concluir o login com Google." },
      { status: 401 }
    )
  }
}

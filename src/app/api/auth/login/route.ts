import { NextRequest, NextResponse } from "next/server"
import {
  login,
  createSession,
  getSessionCookieOptions,
} from "@/lib/auth-service"

export const dynamic = "force-dynamic"

// POST /api/auth/login
//
// Autentica o usuário e cria uma sessão HTTP-only.
// Retorna dados do usuário (NUNCA senha ou hash).
export async function POST(request: NextRequest) {
  try {
    let body: { username?: string; password?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Corpo da requisição inválido." },
        { status: 400 }
      )
    }

    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { error: "Credenciais inválidas." },
        { status: 401 }
      )
    }

    const result = await login(username, password)

    if (!result.success || !result.user) {
      return NextResponse.json(
        { error: result.error || "Credenciais inválidas." },
        { status: 401 }
      )
    }

    // Criar sessão (cookie HTTP-only)
    const token = await createSession(result.user)
    const cookieOptions = getSessionCookieOptions(token)

    const response = NextResponse.json(
      {
        user: {
          id: result.user.id,
          username: result.user.username,
          role: result.user.role,
          professionalId: result.user.professionalId,
          professionalName: result.user.professionalName,
          professionalCouncil: result.user.professionalCouncil,
        },
      },
      { status: 200 }
    )

    response.cookies.set(cookieOptions)

    return response
  } catch (error) {
    console.error("Erro no login:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 }
    )
  }
}
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth-service"

export const dynamic = "force-dynamic"

// GET /api/auth/me
//
// Retorna os dados do usuário autenticado (se houver sessão válida).
// NUNCA retorna senha ou hash.
export async function GET() {
  try {
    const user = await getSession()

    if (!user) {
      return NextResponse.json(
        { error: "Não autenticado." },
        { status: 401 }
      )
    }

    return NextResponse.json(
      {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          professionalId: user.professionalId,
          professionalName: user.professionalName,
          professionalCouncil: user.professionalCouncil,
        },
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("Erro ao verificar sessão:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor." },
      { status: 500 }
    )
  }
}
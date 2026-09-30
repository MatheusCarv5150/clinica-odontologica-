import { NextRequest, NextResponse } from "next/server"
import { getConfig, setConfig } from "@/lib/config-hub"

export const dynamic = "force-dynamic"

// GET /api/config/auth
//
// Retorna as configurações atuais de autenticação.
export async function GET() {
  try {
    const [authRequired, sessionTtlHours, maxLoginAttempts] = await Promise.all([
      getConfig("auth_required"),
      getConfig("session_ttl_hours"),
      getConfig("max_login_attempts"),
    ])

    return NextResponse.json({
      authRequired: authRequired === "true",
      sessionTtlHours: Number(sessionTtlHours),
      maxLoginAttempts: Number(maxLoginAttempts),
    })
  } catch (error) {
    console.error("Erro ao carregar config de auth:", error)
    return NextResponse.json({ error: "Erro interno." }, { status: 500 })
  }
}

// PUT /api/config/auth
//
// Atualiza as configurações de autenticação.
// Body: { authRequired?: boolean, sessionTtlHours?: number, maxLoginAttempts?: number }
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()

    const authRequired = body.authRequired
    const sessionTtlHours = body.sessionTtlHours
    const maxLoginAttempts = body.maxLoginAttempts

    const operations: Promise<void>[] = []

    if (typeof authRequired === "boolean") {
      operations.push(setConfig("auth_required", String(authRequired)))
    }
    if (typeof sessionTtlHours === "number" && sessionTtlHours >= 1) {
      operations.push(setConfig("session_ttl_hours", String(sessionTtlHours)))
    }
    if (typeof maxLoginAttempts === "number" && maxLoginAttempts >= 1) {
      operations.push(setConfig("max_login_attempts", String(maxLoginAttempts)))
    }

    await Promise.all(operations)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao salvar config de auth:", error)
    return NextResponse.json({ error: "Erro interno." }, { status: 500 })
  }
}
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// ===========================================================================
// HEALTH CHECK — GET /api/health
// ===========================================================================
//
// Usado pelo Docker HEALTHCHECK e pelo EasyPanel para verificar se a
// aplicação está viva e se o banco responde.
//
// Retorna:
//   200 { status: "ok", database: "up" }    -> aplicação e banco saudáveis
//   503 { status: "degraded", ... }         -> app viva, banco inacessível
//
// SEGURANÇA: esta rota é PÚBLICA (não exige sessão) e NÃO revela detalhes
// internos (host, credenciais, stack traces). Apenas um sinal binário.
// ===========================================================================

// Nunca cachear: o health check precisa refletir o estado atual.
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    // Consulta trivial: prova que a conexão com o banco está funcionando.
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json(
      { status: "ok", database: "up" },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    )
  } catch {
    return NextResponse.json(
      { status: "degraded", database: "down" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    )
  }
}

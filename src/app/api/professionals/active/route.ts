import { NextResponse } from "next/server"
import { listActiveProfessionals } from "@/lib/professionals-service"

export const dynamic = "force-dynamic"

// ===========================================================================
// GET /api/professionals/active
//
// Lista SOMENTE profissionais ATIVOS — usada pelos seletores de NOVOS
// atendimentos e ações. Profissionais inativos continuam existindo no banco
// (e no histórico), mas não são oferecidos aqui.
// ===========================================================================

export async function GET() {
  try {
    const items = await listActiveProfessionals()
    return NextResponse.json({ items }, { status: 200 })
  } catch (error) {
    console.error("Erro ao listar profissionais ativos:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

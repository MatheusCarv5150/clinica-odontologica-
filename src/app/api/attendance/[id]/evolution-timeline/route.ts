import { NextRequest, NextResponse } from "next/server"
import { getEvolutionTimeline } from "@/lib/evolution-timeline-service"
import { parseTimelineQuery } from "@/lib/evolution-timeline"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/evolution-timeline
//
// LINHA DO TEMPO CLÍNICA do paciente (Parte 8).
//
// Diferente de /evolution (Parte 6 — registro do atendimento atual), este
// endpoint devolve a EVOLUÇÃO CRONOLÓGICA LONGITUDINAL: todos os atendimentos
// do paciente, do mais recente para o mais antigo, com resumo clínico,
// procedimentos realizados, dentes envolvidos e intercorrências.
//
// Parâmetros de consulta (todos opcionais):
//   period=all|30d|6m|1y|custom & from=YYYY-MM-DD & to=YYYY-MM-DD
//   professional=<nome>   procedure=<procedureId>   tooth=<FDI>
//   q=<texto>             includeNonClinical=1      sort=desc|asc
//   page=1                pageSize=10
//
// Segurança / isolamento (LGPD):
// - O paciente NUNCA é recebido por parâmetro. O backend resolve o paciente a
//   partir do atendimento informado e ancora TODOS os filtros nele. Assim não
//   é possível ler a evolução de outro paciente alterando IDs na URL.
// - Todos os filtros (período, profissional, procedimento, dente e busca
//   textual) e a paginação são executados no BANCO — o navegador não recebe
//   o prontuário inteiro para filtrar artificialmente.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { error: "Identificador do atendimento não informado." },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const query = parseTimelineQuery(searchParams)

    const data = await getEvolutionTimeline(id, query)
    if (!data) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Erro ao carregar a evolução clínica do paciente:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

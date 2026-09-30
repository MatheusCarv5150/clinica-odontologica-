import { NextRequest, NextResponse } from "next/server"
import { getAttendanceDetail } from "@/lib/attendance-detail-service"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/records/[recordId]
//
// Atendimento COMPLETO em modo consulta — usado pelo "Ver atendimento completo"
// da EVOLUÇÃO (Parte 8). `[id]` é o atendimento de REFERÊNCIA (o atendimento
// aberto no prontuário) e `[recordId]` é o atendimento a ser consultado.
//
// Segurança (LGPD / isolamento entre pacientes):
// - O atendimento-alvo só é retornado se pertencer ao MESMO paciente do
//   atendimento de referência. Caso contrário, 404 — não confirmamos a
//   existência de registros de outros pacientes.
// - O retorno indica `readOnly` quando o atendimento não está em andamento,
//   para que a interface nunca permita alteração silenciosa de registros
//   antigos.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> }
) {
  try {
    const { id, recordId } = await params

    if (!id || !recordId) {
      return NextResponse.json(
        { error: "Identificador do atendimento não informado." },
        { status: 400 }
      )
    }

    const data = await getAttendanceDetail(id, recordId)
    if (data === "not_found") {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Erro ao carregar o atendimento completo:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

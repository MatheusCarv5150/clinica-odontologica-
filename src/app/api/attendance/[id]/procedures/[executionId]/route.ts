import { NextRequest, NextResponse } from "next/server"
import { updateExecution } from "@/lib/procedures-service"
import { updateProcedureExecutionSchema } from "@/lib/schemas-procedures"

export const dynamic = "force-dynamic"

// PATCH /api/attendance/[id]/procedures/[executionId]
//
// Altera o status de uma execução de procedimento:
// - "performed"     -> marca como realizado (gera evento no odontograma);
// - "not_performed" -> marca como não realizado (com motivo obrigatório);
// - "cancelled"     -> cancelamento controlado (registro preservado);
// - "pending"       -> retorna ao estado de aguardando (correção).
//
// O item da AGENDA nunca é alterado por esta rota: apenas a execução.
// A validação do payload é feita via Zod; as regras de negócio (dente,
// dentição, alteração de valor, isolamento entre pacientes) são validadas
// no SERVIÇO — autoridade final.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  try {
    const { id, executionId } = await params

    if (!id || !executionId) {
      return NextResponse.json(
        { error: "Identificador do atendimento ou do procedimento não informado." },
        { status: 400 }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Corpo da requisição inválido." },
        { status: 400 }
      )
    }

    const parsed = updateProcedureExecutionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Dados inválidos.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      )
    }

    const result = await updateExecution(id, executionId, parsed.data)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(
      { ...result, savedAt: new Date().toISOString() },
      { status: 200 }
    )
  } catch (error) {
    console.error("Erro ao atualizar procedimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from "next/server"
import { updateProcedureEventStatus } from "@/lib/odontogram-service"
import { updateEventStatusSchema } from "@/lib/schemas-odontogram"

export const dynamic = "force-dynamic"

// PATCH /api/attendance/[id]/odontogram/events/[eventId]
//
// Transição de status de um PROCEDIMENTO PLANEJADO:
//   planned -> performed | cancelled
//
// O planejado nunca é sobrescrito: ao marcar como realizado, um NOVO evento
// clínico é criado e o registro do planejamento permanece no histórico.
// Este é o gancho do futuro Plano de Tratamento.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const { id, eventId } = await params

    if (!id || !eventId) {
      return NextResponse.json(
        { error: "Identificadores não informados." },
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

    const parsed = updateEventStatusSchema.safeParse(body)
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

    const result = await updateProcedureEventStatus(id, eventId, parsed.data)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json({
      success: true,
      status: parsed.data.status,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Erro ao atualizar status do procedimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

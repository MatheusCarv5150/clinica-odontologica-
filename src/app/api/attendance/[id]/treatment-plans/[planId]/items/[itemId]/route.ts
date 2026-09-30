import { NextRequest, NextResponse } from "next/server"
import { archivePlanItem, updatePlanItem } from "@/lib/treatment-plan-service"
import { updateTreatmentPlanItemSchema } from "@/lib/schemas-treatment-plan"

export const dynamic = "force-dynamic"

// PATCH /api/attendance/[id]/treatment-plans/[planId]/items/[itemId]
//
// Atualiza um item do plano, incluindo a transição de status. A mudança de
// status é registrada na trilha de auditoria (status anterior, novo, data e
// autor) — o histórico do item nunca é perdido.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; itemId: string }> }
) {
  try {
    const { id, planId, itemId } = await params
    if (!id || !planId || !itemId) {
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

    const parsed = updateTreatmentPlanItemSchema.safeParse(body)
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

    const result = await updatePlanItem(id, planId, itemId, parsed.data)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao atualizar item do plano:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// DELETE /api/attendance/[id]/treatment-plans/[planId]/items/[itemId]
//
// Remove o item do plano de forma LÓGICA: o item é marcado como "cancelled" e
// a mudança é auditada. O histórico clínico NUNCA é apagado fisicamente.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string; itemId: string }> }
) {
  try {
    const { id, planId, itemId } = await params
    if (!id || !planId || !itemId) {
      return NextResponse.json(
        { error: "Identificadores não informados." },
        { status: 400 }
      )
    }

    const url = new URL(request.url)
    const reason = url.searchParams.get("reason")
    const performedByName = url.searchParams.get("by")

    const result = await archivePlanItem(
      id,
      planId,
      itemId,
      performedByName,
      reason
    )

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao remover item do plano:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from "next/server"
import { updatePlan } from "@/lib/treatment-plan-service"
import { updateTreatmentPlanSchema } from "@/lib/schemas-treatment-plan"

export const dynamic = "force-dynamic"

// PATCH /api/attendance/[id]/treatment-plans/[planId]
//
// Atualiza título/descrição/status do plano. O paciente é resolvido no
// servidor; um plano de outro paciente não é acessível por esta rota.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
) {
  try {
    const { id, planId } = await params
    if (!id || !planId) {
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

    const parsed = updateTreatmentPlanSchema.safeParse(body)
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

    const result = await updatePlan(id, planId, parsed.data)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao atualizar plano de tratamento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

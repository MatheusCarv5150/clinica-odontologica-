import { NextRequest, NextResponse } from "next/server"
import { createPlanItem } from "@/lib/treatment-plan-service"
import { createTreatmentPlanItemSchema } from "@/lib/schemas-treatment-plan"

export const dynamic = "force-dynamic"

// POST /api/attendance/[id]/treatment-plans/[planId]/items
//
// Adiciona um item ao plano. O item referencia o catálogo REAL de procedimentos
// e usa a MESMA identificação de dente/superfície do odontograma.
//
// PLANEJADO ≠ REALIZADO: criar um item NÃO altera o estado clínico do dente
// nem registra execução de procedimento.
export async function POST(
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

    const parsed = createTreatmentPlanItemSchema.safeParse(body)
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

    const result = await createPlanItem(id, planId, parsed.data)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(
      { ...result, savedAt: new Date().toISOString() },
      { status: 201 }
    )
  } catch (error) {
    console.error("Erro ao adicionar item ao plano:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

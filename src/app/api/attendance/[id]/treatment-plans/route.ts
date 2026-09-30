import { NextRequest, NextResponse } from "next/server"
import {
  createPlan,
  getTreatmentPlans,
} from "@/lib/treatment-plan-service"
import { createTreatmentPlanSchema } from "@/lib/schemas-treatment-plan"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/treatment-plans
//
// Planos de tratamento do paciente vinculado ao atendimento. O paciente é
// resolvido SEMPRE no servidor a partir do atendimento (isolamento/LGPD).
export async function GET(
  _request: NextRequest,
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

    const data = await getTreatmentPlans(id)
    if (!data) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Erro ao carregar planos de tratamento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// POST /api/attendance/[id]/treatment-plans
//
// Cria um plano de tratamento do paciente. O item do plano referencia o
// catálogo REAL de procedimentos (sem duplicar cadastro).
export async function POST(
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

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Corpo da requisição inválido." },
        { status: 400 }
      )
    }

    const parsed = createTreatmentPlanSchema.safeParse(body)
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

    const result = await createPlan(id, parsed.data)

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
    console.error("Erro ao criar plano de tratamento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

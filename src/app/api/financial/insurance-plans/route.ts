import { NextRequest, NextResponse } from "next/server"
import { createInsurancePlan, listInsurancePlans } from "@/lib/financial-expense-service"
import { isFinancialError } from "@/lib/financial-service"
import { insurancePlanSchema } from "@/lib/schemas-financial"

export const dynamic = "force-dynamic"

// GET /api/financial/insurance-plans?includeInactive=true
//
// Catálogo de convênios. O convênio NÃO altera o valor praticado: os valores
// continuam vindo de `appointments.total_amount` /
// `appointment_procedures.total_price`. Ele registra a origem/cobertura.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const includeInactive = searchParams.get("includeInactive") === "true"
    const plans = await listInsurancePlans({ includeInactive })
    return NextResponse.json({ plans })
  } catch (error) {
    console.error("Erro ao listar convênios:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST /api/financial/insurance-plans
export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 })
    }

    const parsed = insurancePlanSchema.safeParse(body)
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

    const result = await createInsurancePlan(parsed.data)
    if (isFinancialError(result)) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json({ plan: result }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar convênio:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

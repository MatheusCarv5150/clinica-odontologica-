// ===========================================================================
// API DE DESPESAS — CAMADA DE COMPATIBILIDADE (/api/financial/expenses).
// ===========================================================================
//
// A rota canônica de Despesas é `/api/financial/despesas`.
//
// Esta rota existe apenas para não quebrar consumidores legados. Ela NÃO
// contém regra de negócio própria: apenas valida entrada e delega ao MESMO
// service canônico (`@/lib/financial-expense-service`).
//
// NÃO ADICIONE lógica financeira aqui.

import { NextRequest, NextResponse } from "next/server"
import { isFinancialError } from "@/lib/financial-service"
import {
  createDespesa,
  updateDespesa,
  payExpense,
  cancelDespesa,
  listExpenses,
} from "@/lib/financial-expense-service"
import {
  createExpenseSchema,
  updateExpenseSchema,
  payExpenseSchema,
  cancelExpenseSchema,
} from "@/lib/schemas-financial"

export const dynamic = "force-dynamic"

// GET /api/financial/expenses?period=month&status=pending&categoryId=...&limit=50
// Compatibilidade: delega para a listagem canônica.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const status = searchParams.get("status") ?? undefined
    const categoryId = searchParams.get("categoryId") ?? undefined
    const period = searchParams.get("period") ?? undefined
    const from = searchParams.get("from") ?? undefined
    const to = searchParams.get("to") ?? undefined
    const limitRaw = Number(searchParams.get("limit") ?? "50")

    const expenses = await listExpenses({
      status,
      categoryId,
      preset: period,
      from,
      to,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    })

    return NextResponse.json({ expenses })
  } catch (error) {
    console.error("Erro ao listar despesas:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST /api/financial/expenses — cria despesa (delega ao service canônico).
export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 })
    }

    const parsed = createExpenseSchema.safeParse(body)
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

    const data = parsed.data
    const result = await createDespesa(
      {
        categoryId: data.categoryId,
        description: data.description,
        supplier: data.supplier,
        amount: data.amount,
        competenceDate: data.competenceDate,
        dueDate: data.dueDate,
        appointmentId: data.appointmentId,
        patientId: data.patientId,
        notes: data.notes,
        paymentMethod: data.paymentMethod,
        documentNumber: data.documentNumber,
        isRecurring: data.isRecurring,
        markAsPaid: data.markAsPaid,
      },
      { userId: null, name: data.actorName ?? "" }
    )

    if (isFinancialError(result)) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json({ expense: result }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar despesa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// PATCH /api/financial/expenses — ações: update | pay | cancel (delega).
export async function PATCH(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 })
    }

    const payload = body as { id?: string; action?: string }
    if (!payload?.id || typeof payload.id !== "string") {
      return NextResponse.json(
        { error: "Identificador da despesa é obrigatório." },
        { status: 400 }
      )
    }

    const action = payload.action ?? "update"
    const actor = { userId: null as string | null, name: "" }

    if (action === "pay") {
      const parsed = payExpenseSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: "Dados inválidos." }, { status: 400 })
      }
      const result = await payExpense(
        payload.id,
        { paymentMethod: parsed.data.paymentMethod },
        { userId: null, name: parsed.data.actorName ?? "" }
      )
      if (isFinancialError(result)) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: result.status }
        )
      }
      return NextResponse.json({ expense: result })
    }

    if (action === "cancel") {
      const parsed = cancelExpenseSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: "Dados inválidos." }, { status: 400 })
      }
      const result = await cancelDespesa(
        payload.id,
        parsed.data.reason ?? null,
        { userId: null, name: parsed.data.actorName ?? "" }
      )
      if (isFinancialError(result)) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: result.status }
        )
      }
      return NextResponse.json({ expense: result })
    }

    if (action === "update") {
      const parsed = updateExpenseSchema.safeParse(body)
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
      const result = await updateDespesa(payload.id, parsed.data, actor)
      if (isFinancialError(result)) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: result.status }
        )
      }
      return NextResponse.json({ expense: result })
    }

    return NextResponse.json(
      { error: `Ação desconhecida: ${action}. Use update, pay ou cancel.` },
      { status: 400 }
    )
  } catch (error) {
    console.error("Erro ao processar despesa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

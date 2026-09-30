// ===========================================================================
// API DE DESPESAS — módulo Financeiro (Financeiro 4).
// ===========================================================================

import { NextRequest, NextResponse } from "next/server"
import { isFinancialError } from "@/lib/financial-service"
import {
  createDespesa,
  updateDespesa,
  cancelDespesa,
  registerDespesaPayment,
  listDespesas,
  getDespesaDetail,
  ensureDefaultExpenseCategories,
} from "@/lib/financial-expense-service"
import {
  createDespesaSchema,
  updateDespesaSchema,
  cancelDespesaSchema,
  registerDespesaPaymentSchema,
  listDespesasSchema,
} from "@/lib/schemas-financial"

export const dynamic = "force-dynamic"

// ===========================================================================
// GET /api/financial/despesas
// ===========================================================================
// Lista despesas com filtros, busca, paginação e summary.
//
// Parâmetros:
//   period - today|7d|30d|month|year|all|custom (padrão: month)
//   from, to - datas YYYY-MM-DD (custom period)
//   status - pending|partial|paid|cancelled
//   categoryId - filtrar por categoria
//   paymentMethod - filtrar por método
//   supplier - filtrar por fornecedor
//   search - busca textual (descrição, fornecedor, observação, ID)
//   sort - dueDate|amount|description|supplier|competenceDate
//   direction - asc|desc
//   page - número da página (padrão: 1)
//   pageSize - itens por página (padrão: 20)
// ===========================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    // Se tem id, retorna detalhe
    if (id) {
      const detail = await getDespesaDetail(id)
      if (!detail) {
        return NextResponse.json({ error: "Despesa não encontrada." }, { status: 404 })
      }
      return NextResponse.json({ despesa: detail })
    }

    // Parse dos parâmetros
    const rawPeriod = searchParams.get("period") ?? "month"
    const rawPage = searchParams.get("page") ?? "1"
    const rawPageSize = searchParams.get("pageSize") ?? "20"

    const parsed = listDespesasSchema.safeParse({
      period: rawPeriod,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      categoryId: searchParams.get("categoryId") ?? undefined,
      paymentMethod: searchParams.get("paymentMethod") ?? undefined,
      supplier: searchParams.get("supplier") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      sort: searchParams.get("sort") ?? "dueDate",
      direction: searchParams.get("direction") ?? "asc",
      page: rawPage,
      pageSize: rawPageSize,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Parâmetros inválidos.", details: parsed.error.issues },
        { status: 400 }
      )
    }

    const opts = parsed.data

    // Garante categorias padrão (idempotente)
    await ensureDefaultExpenseCategories()

    const result = await listDespesas({
      period: opts.period,
      from: opts.from,
      to: opts.to,
      status: opts.status,
      categoryId: opts.categoryId,
      paymentMethod: opts.paymentMethod,
      supplier: opts.supplier,
      search: opts.search,
      sort: opts.sort,
      direction: opts.direction,
      page: opts.page,
      pageSize: opts.pageSize,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao listar despesas:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// ===========================================================================
// POST /api/financial/despesas
// ===========================================================================
// Cria uma nova despesa.

export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 })
    }

    const parsed = createDespesaSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Dados inválidos.",
          details: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
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

    return NextResponse.json({ despesa: result }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar despesa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// ===========================================================================
// PATCH /api/financial/despesas
// ===========================================================================
// Ações: update | pay | cancel

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

    // --- PAGAMENTO ---
    if (action === "pay") {
      const parsed = registerDespesaPaymentSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Dados inválidos.",
            details: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
          { status: 400 }
        )
      }

      const result = await registerDespesaPayment(
        {
          expenseId: payload.id,
          amount: parsed.data.amount,
          paymentMethod: parsed.data.paymentMethod,
          paidAt: parsed.data.paidAt,
          notes: parsed.data.notes,
        },
        { userId: null, name: parsed.data.actorName ?? "" }
      )

      if (isFinancialError(result)) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: result.status }
        )
      }

      return NextResponse.json({ payment: result })
    }

    // --- CANCELAMENTO ---
    if (action === "cancel") {
      const parsed = cancelDespesaSchema.safeParse(body)
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

      return NextResponse.json({ despesa: result })
    }

    // --- ATUALIZAÇÃO ---
    if (action === "update") {
      const parsed = updateDespesaSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Dados inválidos.",
            details: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
          { status: 400 }
        )
      }

      const result = await updateDespesa(payload.id, parsed.data, {
        userId: null,
        name: parsed.data.actorName ?? "",
      })

      if (isFinancialError(result)) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: result.status }
        )
      }

      return NextResponse.json({ despesa: result })
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

// ===========================================================================
// DELETE /api/financial/despesas
// ===========================================================================
// NÃO implementado: despesas são canceladas, não excluídas fisicamente.

export async function DELETE() {
  return NextResponse.json(
    { error: "Despesas não podem ser excluídas. Use a ação 'cancel' para cancelar." },
    { status: 405 }
  )
}
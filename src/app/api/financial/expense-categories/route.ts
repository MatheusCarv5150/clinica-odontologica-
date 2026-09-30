import { NextRequest, NextResponse } from "next/server"
import {
  createExpenseCategory,
  ensureDefaultExpenseCategories,
  listExpenseCategories,
} from "@/lib/financial-expense-service"
import { isFinancialError } from "@/lib/financial-service"
import { expenseCategorySchema } from "@/lib/schemas-financial"

export const dynamic = "force-dynamic"

// GET /api/financial/expense-categories?includeInactive=true
//
// Categorias de despesa são DADOS DE REFERÊNCIA — não são valores financeiros
// e não entram em nenhum total.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const includeInactive = searchParams.get("includeInactive") === "true"

    // Garante o conjunto padrão (idempotente; não cria despesa alguma).
    if (searchParams.get("seed") !== "0") {
      await ensureDefaultExpenseCategories()
    }

    const categories = await listExpenseCategories({ includeInactive })
    return NextResponse.json({ categories })
  } catch (error) {
    console.error("Erro ao listar categorias de despesa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST /api/financial/expense-categories
export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 })
    }

    const parsed = expenseCategorySchema.safeParse(body)
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

    const result = await createExpenseCategory(parsed.data)
    if (isFinancialError(result)) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json({ category: result }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar categoria de despesa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

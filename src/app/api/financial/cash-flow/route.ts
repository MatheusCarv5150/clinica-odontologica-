// ===========================================================================
// API DO FLUXO DE CAIXA — módulo Financeiro (Financeiro 5).
// ===========================================================================
//
// Somente LEITURA. O fluxo de caixa é DERIVADO das fontes de verdade
// (`payments` e `expense_payments`): não há POST/PUT/DELETE aqui, porque não
// existe uma segunda fonte de verdade a manter.
//
// GET /api/financial/cash-flow
//   Lista as movimentações do período com filtros, busca, agrupamento por dia,
//   série do gráfico, saldo do período e saldo acumulado.
//
//   Parâmetros:
//     period - today|7d|30d|month|year|custom (padrão: month)
//     from, to - datas YYYY-MM-DD (período custom)
//     type - ALL|INCOME|EXPENSE (padrão: ALL)
//     paymentMethod - filtrar por método
//     categoryId - filtrar por categoria (saídas)
//     source - PAYMENT|EXPENSE_PAYMENT
//     patientId - filtrar por paciente (entradas)
//     supplier - filtrar por fornecedor (saídas)
//     professionalName - filtrar por profissional (entradas)
//     search - busca textual (paciente, fornecedor, descrição, procedimento, id)
//     sort - date|amount
//     direction - asc|desc
//     page, pageSize
//
// GET /api/financial/cash-flow?id=<movementId>
//   Detalhe de UMA movimentação (com histórico da origem).

import { NextRequest, NextResponse } from "next/server"
import { listCashFlow, getCashFlowDetail } from "@/lib/financial-cash-flow-service"
import { listCashFlowSchema } from "@/lib/schemas-financial"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Detalhe de uma movimentação.
    const id = searchParams.get("id")
    if (id) {
      const detail = await getCashFlowDetail(id)
      if (!detail) {
        return NextResponse.json(
          { error: "Movimentação não encontrada." },
          { status: 404 }
        )
      }
      return NextResponse.json({ movement: detail })
    }

    const parsed = listCashFlowSchema.safeParse({
      period: searchParams.get("period") ?? "month",
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      type: searchParams.get("type") ?? "ALL",
      paymentMethod: searchParams.get("paymentMethod") ?? undefined,
      categoryId: searchParams.get("categoryId") ?? undefined,
      source: searchParams.get("source") ?? undefined,
      patientId: searchParams.get("patientId") ?? undefined,
      supplier: searchParams.get("supplier") ?? undefined,
      professionalName: searchParams.get("professionalName") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      sort: searchParams.get("sort") ?? "date",
      direction: searchParams.get("direction") ?? "desc",
      page: searchParams.get("page") ?? "1",
      pageSize: searchParams.get("pageSize") ?? "20",
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Parâmetros inválidos.", details: parsed.error.issues },
        { status: 400 }
      )
    }

    const opts = parsed.data
    const result = await listCashFlow({
      period: opts.period,
      from: opts.from,
      to: opts.to,
      type: opts.type,
      paymentMethod: opts.paymentMethod,
      categoryId: opts.categoryId,
      source: opts.source,
      patientId: opts.patientId,
      supplier: opts.supplier,
      professionalName: opts.professionalName,
      search: opts.search,
      sort: opts.sort,
      direction: opts.direction,
      page: opts.page,
      pageSize: opts.pageSize,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao listar o fluxo de caixa:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

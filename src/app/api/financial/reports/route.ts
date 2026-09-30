// ===========================================================================
// API DE RELATÓRIOS FINANCEIROS — módulo Financeiro (Financeiro 6).
// ===========================================================================
//
// Somente LEITURA. Os relatórios são CONSOLIDAÇÕES dos serviços existentes
// (Financeiros 1–5): não há fonte nova e não há escrita aqui.
//
// GET /api/financial/reports?report=<tipo>
//
//   report=overview        -> resumo + séries dos gráficos (visão inicial)
//   report=summary         -> resumo financeiro (cards + resultado)
//   report=income          -> relatório de receitas
//   report=expense         -> relatório de despesas
//   report=cash-flow       -> relatório de fluxo de caixa
//   report=receivable      -> relatório de contas a receber
//   report=procedure       -> relatório por procedimento
//   report=payment-method  -> recebimentos por forma de pagamento
//
// Parâmetros comuns: period, from, to. Cada relatório aceita os filtros do
// serviço de origem (status, paymentMethod, professionalName, categoryId,
// supplier, search, sort, direction, page, pageSize).
//
// TODOS os filtros são processados no BACKEND. O cliente nunca baixa a base
// inteira para filtrar.

import { NextRequest, NextResponse } from "next/server"
import {
  getReportsOverview,
  getFinancialSummary,
  getIncomeReport,
  getExpenseReport,
  getCashFlowReport,
  getReceivableReport,
  getProcedureReport,
  getPaymentMethodReport,
} from "@/lib/financial-reports-service"
import {
  reportPeriodSchema,
  reportReceitasSchema,
  reportDespesasSchema,
  reportCashFlowSchema,
  reportContasReceberSchema,
  reportPaymentMethodsSchema,
} from "@/lib/schemas-financial"

export const dynamic = "force-dynamic"

/** Lê os campos comuns de período dos searchParams. */
function periodParams(searchParams: URLSearchParams) {
  return {
    period: searchParams.get("period") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const report = searchParams.get("report") ?? "overview"
    const period = periodParams(searchParams)

    switch (report) {
      case "overview": {
        const parsed = reportPeriodSchema.safeParse(period)
        if (!parsed.success) return invalid(parsed.error.issues)
        return NextResponse.json(
          await getReportsOverview({
            period: parsed.data.period,
            from: parsed.data.from,
            to: parsed.data.to,
          })
        )
      }

      case "summary": {
        const parsed = reportPeriodSchema.safeParse(period)
        if (!parsed.success) return invalid(parsed.error.issues)
        return NextResponse.json(
          await getFinancialSummary({
            period: parsed.data.period,
            from: parsed.data.from,
            to: parsed.data.to,
          })
        )
      }

      case "income": {
        const parsed = reportReceitasSchema.safeParse({
          ...period,
          status: searchParams.get("status") ?? undefined,
          paymentMethod: searchParams.get("paymentMethod") ?? undefined,
          professionalName: searchParams.get("professionalName") ?? undefined,
          search: searchParams.get("search") ?? undefined,
          page: searchParams.get("page") ?? undefined,
          pageSize: searchParams.get("pageSize") ?? undefined,
        })
        if (!parsed.success) return invalid(parsed.error.issues)
        return NextResponse.json(await getIncomeReport(parsed.data))
      }

      case "expense": {
        const parsed = reportDespesasSchema.safeParse({
          ...period,
          status: searchParams.get("status") ?? undefined,
          categoryId: searchParams.get("categoryId") ?? undefined,
          paymentMethod: searchParams.get("paymentMethod") ?? undefined,
          supplier: searchParams.get("supplier") ?? undefined,
          search: searchParams.get("search") ?? undefined,
          sort: searchParams.get("sort") ?? undefined,
          direction: searchParams.get("direction") ?? undefined,
          page: searchParams.get("page") ?? undefined,
          pageSize: searchParams.get("pageSize") ?? undefined,
        })
        if (!parsed.success) return invalid(parsed.error.issues)
        return NextResponse.json(await getExpenseReport(parsed.data))
      }

      case "cash-flow": {
        const parsed = reportCashFlowSchema.safeParse({
          ...period,
          type: searchParams.get("type") ?? undefined,
          paymentMethod: searchParams.get("paymentMethod") ?? undefined,
          source: searchParams.get("source") ?? undefined,
          search: searchParams.get("search") ?? undefined,
          page: searchParams.get("page") ?? undefined,
          pageSize: searchParams.get("pageSize") ?? undefined,
        })
        if (!parsed.success) return invalid(parsed.error.issues)
        return NextResponse.json(await getCashFlowReport(parsed.data))
      }

      case "receivable": {
        const parsed = reportContasReceberSchema.safeParse({
          ...period,
          status: searchParams.get("status") ?? undefined,
          search: searchParams.get("search") ?? undefined,
          patientName: searchParams.get("patientName") ?? undefined,
          procedureName: searchParams.get("procedureName") ?? undefined,
          professionalName: searchParams.get("professionalName") ?? undefined,
          sort: searchParams.get("sort") ?? undefined,
          direction: searchParams.get("direction") ?? undefined,
          page: searchParams.get("page") ?? undefined,
          pageSize: searchParams.get("pageSize") ?? undefined,
        })
        if (!parsed.success) return invalid(parsed.error.issues)
        return NextResponse.json(await getReceivableReport(parsed.data))
      }

      case "procedure": {
        const parsed = reportPeriodSchema.safeParse(period)
        if (!parsed.success) return invalid(parsed.error.issues)
        return NextResponse.json(
          await getProcedureReport({
            period: parsed.data.period,
            from: parsed.data.from,
            to: parsed.data.to,
          })
        )
      }

      case "payment-method": {
        const parsed = reportPaymentMethodsSchema.safeParse({
          ...period,
          professionalName: searchParams.get("professionalName") ?? undefined,
          search: searchParams.get("search") ?? undefined,
        })
        if (!parsed.success) return invalid(parsed.error.issues)
        return NextResponse.json(await getPaymentMethodReport(parsed.data))
      }

      default:
        return NextResponse.json(
          { error: "Relatório desconhecido.", report },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error("Erro ao gerar relatório financeiro:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

function invalid(details: unknown) {
  return NextResponse.json({ error: "Parâmetros inválidos.", details }, { status: 400 })
}

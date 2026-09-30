"use client"

// ===========================================================================
// PAINEL DE RELATÓRIOS FINANCEIROS — módulo Financeiro (Financeiro 6).
// ===========================================================================
//
// Tela de RELATÓRIOS com abas, gráficos e exportação CSV. É uma camada de
// APRESENTAÇÃO: nenhum cálculo financeiro é feito aqui. Os números chegam
// prontos de `/api/financial/reports` (que por sua vez consolida os
// Financeiros 1–5).
//
// REGRAS DE HONESTIDADE VISUAL (mesmas do restante do módulo):
//   * todo valor tem rótulo e definição (recebido x previsto x resultado);
//   * "resultado" NUNCA é chamado de lucro;
//   * vazio mostra R$ 0,00 com aviso — nunca inventa dado para o gráfico;
//   * a exportação CSV respeita exatamente os filtros do período.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/schemas"
import {
  buildCsv,
  downloadCsv,
  reportFileName,
  formatCsvDate,
  type CsvColumn,
} from "@/lib/csv-export"
import {
  MetricCard,
  EmptyState,
  FlowChart,
  ShareBar,
} from "@/components/financeiro/financial-ui"
import type {
  ReportsOverview,
  IncomeReport,
  ExpenseReport,
  CashFlowReport,
  ReceivableReport,
  ProcedureReport,
  PaymentMethodReport,
  BreakdownItem,
} from "@/lib/financial-reports-service"
import { FinancialClosingPanel } from "@/components/financeiro/financial-closing-panel"

type TabKey =
  | "overview"
  | "income"
  | "expense"
  | "cash-flow"
  | "receivable"
  | "procedure"
  | "payment-method"
  | "closing"

const TABS: { key: TabKey; label: string; report?: string }[] = [
  { key: "overview", label: "Visão geral", report: "overview" },
  { key: "income", label: "Receitas", report: "income" },
  { key: "expense", label: "Despesas", report: "expense" },
  { key: "cash-flow", label: "Fluxo de caixa", report: "cash-flow" },
  { key: "receivable", label: "A receber", report: "receivable" },
  { key: "procedure", label: "Procedimentos", report: "procedure" },
  { key: "payment-method", label: "Formas de pagamento", report: "payment-method" },
  { key: "closing", label: "Fechamento" },
]

const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "month", label: "Mês" },
  { key: "year", label: "Ano" },
  { key: "all", label: "Tudo" },
]

// ---------------------------------------------------------------------------
// Período padrão (mês atual) — calculado no cliente para os campos `from/to`.
// ---------------------------------------------------------------------------

function currentMonthRange(): { from: string; to: string } {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`
  return { from: fmt(first), to: fmt(last) }
}

export function ReportsPanel() {
  const [tab, setTab] = useState<TabKey>("overview")
  const [period, setPeriod] = useState("month")
  const [range, setRange] = useState(currentMonthRange)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [overview, setOverview] = useState<ReportsOverview | null>(null)
  const [income, setIncome] = useState<IncomeReport | null>(null)
  const [expense, setExpense] = useState<ExpenseReport | null>(null)
  const [cashFlow, setCashFlow] = useState<CashFlowReport | null>(null)
  const [receivable, setReceivable] = useState<ReceivableReport | null>(null)
  const [procedure, setProcedure] = useState<ProcedureReport | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodReport | null>(null)

  // Monta a query string do período (custom usa from/to).
  const periodQuery = useMemo(() => {
    const params = new URLSearchParams()
    params.set("period", period)
    if (period === "custom") {
      params.set("from", range.from)
      params.set("to", range.to)
    }
    return params
  }, [period, range])

  const load = useCallback(
    async (target: TabKey) => {
      const definition = TABS.find((t) => t.key === target)
      if (!definition?.report) return
      // `await` inicial: a regra `react-hooks/set-state-in-effect` proíbe
      // setState síncrono no corpo de um efeito (cascata de renders).
      await Promise.resolve()
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams(periodQuery)
        params.set("report", definition.report)
        const res = await fetch(`/api/financial/reports?${params.toString()}`, {
          cache: "no-store",
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? "Falha ao gerar relatório.")
        switch (target) {
          case "overview":
            setOverview(json as ReportsOverview)
            break
          case "income":
            setIncome(json as IncomeReport)
            break
          case "expense":
            setExpense(json as ExpenseReport)
            break
          case "cash-flow":
            setCashFlow(json as CashFlowReport)
            break
          case "receivable":
            setReceivable(json as ReceivableReport)
            break
          case "procedure":
            setProcedure(json as ProcedureReport)
            break
          case "payment-method":
            setPaymentMethod(json as PaymentMethodReport)
            break
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao carregar relatório.")
      } finally {
        setLoading(false)
      }
    },
    [periodQuery]
  )

  useEffect(() => {
    if (tab === "closing") return
    // Adia para fora do corpo síncrono do efeito (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => void load(tab), 0)
    return () => clearTimeout(timer)
  }, [tab, load])

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Relatórios</h1>
          <p className="mt-1 text-sm text-gray-500">
            Consolidação de receitas, despesas, caixa e contas a receber. Todos os filtros
            são aplicados no servidor.
          </p>
        </div>
        {tab !== "closing" && (
          <ReportActions
            data={selectExport(tab, {
              overview,
              income,
              expense,
              cashFlow,
              receivable,
              procedure,
              paymentMethod,
            })}
          />
        )}
      </div>

      {/* Filtro de período */}
      {tab !== "closing" && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Período
            </span>
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  period === p.key
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                )}
              >
                {p.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <input
                type="date"
                value={range.from}
                onChange={(e) => {
                  setRange((r) => ({ ...r, from: e.target.value }))
                  setPeriod("custom")
                }}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              <span className="text-gray-400">até</span>
              <input
                type="date"
                value={range.to}
                onChange={(e) => {
                  setRange((r) => ({ ...r, to: e.target.value }))
                  setPeriod("custom")
                }}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Abas */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && tab !== "closing" ? (
        <div className="py-16 text-center text-sm text-gray-500">
          Carregando relatório…
        </div>
      ) : (
        <div className="space-y-5">
          {tab === "overview" && <OverviewTab data={overview} />}
          {tab === "income" && <IncomeTab data={income} />}
          {tab === "expense" && <ExpenseTab data={expense} />}
          {tab === "cash-flow" && <CashFlowTab data={cashFlow} />}
          {tab === "receivable" && <ReceivableTab data={receivable} />}
          {tab === "procedure" && <ProcedureTab data={procedure} />}
          {tab === "payment-method" && <PaymentMethodTab data={paymentMethod} />}
          {tab === "closing" && <FinancialClosingPanel />}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exportação — seleciona dados e colunas por aba
// ---------------------------------------------------------------------------

interface ExportData {
  overview: ReportsOverview | null
  income: IncomeReport | null
  expense: ExpenseReport | null
  cashFlow: CashFlowReport | null
  receivable: ReceivableReport | null
  procedure: ProcedureReport | null
  paymentMethod: PaymentMethodReport | null
}

function selectExport(tab: TabKey, data: ExportData): { rows: unknown[]; columns: CsvColumn<unknown>[]; name: string } | null {
  switch (tab) {
    case "income":
      if (!data.income) return null
      return { rows: data.income.rows, columns: incomeColumns(), name: "receitas" }
    case "expense":
      if (!data.expense) return null
      return { rows: data.expense.rows, columns: expenseColumns(), name: "despesas" }
    case "cash-flow":
      if (!data.cashFlow) return null
      return { rows: data.cashFlow.rows, columns: cashFlowColumns(), name: "fluxo-caixa" }
    case "receivable":
      if (!data.receivable) return null
      return { rows: data.receivable.rows, columns: receivableColumns(), name: "contas-receber" }
    case "procedure":
      if (!data.procedure) return null
      return { rows: data.procedure.rows, columns: procedureColumns(), name: "procedimentos" }
    case "payment-method":
      if (!data.paymentMethod) return null
      return { rows: data.paymentMethod.rows, columns: paymentMethodColumns(), name: "formas-pagamento" }
    case "overview":
      if (!data.overview) return null
      return { rows: [data.overview.summary], columns: summaryColumns(), name: "resumo" }
    default:
      return null
  }
}

function incomeColumns(): CsvColumn<unknown>[] {
  return [
    { header: "Data", value: (r) => formatCsvDate((r as { date: string }).date) },
    { header: "Paciente", value: (r) => (r as { patientName: string }).patientName },
    { header: "Atendimento", value: (r) => (r as { appointmentCode: string | null }).appointmentCode },
    { header: "Procedimentos", value: (r) => (r as { procedures: string }).procedures },
    { header: "Profissional", value: (r) => (r as { professionalName: string | null }).professionalName },
    { header: "Forma", value: (r) => (r as { paymentMethodLabel: string }).paymentMethodLabel },
    { header: "Valor", value: (r) => (r as { amount: number }).amount },
  ]
}

function expenseColumns(): CsvColumn<unknown>[] {
  return [
    { header: "Descrição", value: (r) => (r as { description: string }).description },
    { header: "Categoria", value: (r) => (r as { categoryName: string }).categoryName },
    { header: "Fornecedor", value: (r) => (r as { supplier: string | null }).supplier },
    { header: "Vencimento", value: (r) => formatCsvDate((r as { dueDate: string | null }).dueDate) },
    { header: "Valor", value: (r) => (r as { amount: number }).amount },
    { header: "Pago", value: (r) => (r as { paidAmount: number }).paidAmount },
    { header: "Saldo", value: (r) => (r as { balance: number }).balance },
    { header: "Situação", value: (r) => (r as { statusLabel: string }).statusLabel },
  ]
}

function cashFlowColumns(): CsvColumn<unknown>[] {
  return [
    { header: "Data", value: (r) => formatCsvDate((r as { date: string }).date) },
    { header: "Tipo", value: (r) => (r as { typeLabel: string }).typeLabel },
    { header: "Origem", value: (r) => (r as { originLabel: string }).originLabel },
    { header: "Descrição", value: (r) => (r as { description: string }).description },
    { header: "Contraparte", value: (r) => (r as { counterparty: string | null }).counterparty },
    { header: "Forma", value: (r) => (r as { paymentMethodLabel: string }).paymentMethodLabel },
    { header: "Valor", value: (r) => (r as { amount: number }).amount },
    { header: "Saldo", value: (r) => (r as { runningBalance: number }).runningBalance },
  ]
}

function receivableColumns(): CsvColumn<unknown>[] {
  return [
    { header: "Paciente", value: (r) => (r as { patientName: string }).patientName },
    { header: "Atendimento", value: (r) => (r as { appointmentCode: string }).appointmentCode },
    { header: "Procedimentos", value: (r) => (r as { procedures: string }).procedures },
    { header: "Vencimento", value: (r) => formatCsvDate((r as { dueDate: string }).dueDate) },
    { header: "Previsto", value: (r) => (r as { expectedAmount: number }).expectedAmount },
    { header: "Recebido", value: (r) => (r as { receivedAmount: number }).receivedAmount },
    { header: "Saldo", value: (r) => (r as { balance: number }).balance },
    { header: "Situação", value: (r) => (r as { statusLabel: string }).statusLabel },
  ]
}

function procedureColumns(): CsvColumn<unknown>[] {
  return [
    { header: "Procedimento", value: (r) => (r as { name: string }).name },
    { header: "Quantidade", value: (r) => (r as { quantity: number }).quantity },
    { header: "Cobrado", value: (r) => (r as { chargedAmount: number }).chargedAmount },
    { header: "Recebido", value: (r) => (r as { receivedAmount: number }).receivedAmount },
    { header: "Pendente", value: (r) => (r as { pendingAmount: number }).pendingAmount },
    { header: "% do recebido", value: (r) => (r as { shareOfReceivedPercent: number }).shareOfReceivedPercent },
  ]
}

function paymentMethodColumns(): CsvColumn<unknown>[] {
  return [
    { header: "Forma", value: (r) => (r as { label: string }).label },
    { header: "Quantidade", value: (r) => (r as { count: number }).count },
    { header: "Valor", value: (r) => (r as { amount: number }).amount },
    { header: "% do total", value: (r) => (r as { sharePercent: number }).sharePercent },
  ]
}

function summaryColumns(): CsvColumn<unknown>[] {
  return [
    { header: "Receitas recebidas", value: (r) => (r as FinancialSummaryExport).result.income },
    { header: "Despesas pagas", value: (r) => (r as FinancialSummaryExport).result.expense },
    { header: "Resultado do período", value: (r) => (r as FinancialSummaryExport).result.value },
  ]
}

interface FinancialSummaryExport {
  result: { income: number; expense: number; value: number }
}

function ReportActions({
  data,
}: {
  data: { rows: unknown[]; columns: CsvColumn<unknown>[]; name: string } | null
}) {
  const disabled = !data || data.rows.length === 0
  const handleExport = () => {
    if (!data) return
    const csv = buildCsv(data.rows, data.columns)
    downloadCsv(reportFileName(data.name), csv)
  }
  return (
    <Button variant="outline" onClick={handleExport} disabled={disabled}>
      Exportar CSV
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Aba: Visão geral
// ---------------------------------------------------------------------------

function OverviewTab({ data }: { data: ReportsOverview | null }) {
  if (!data) return <EmptyState title="Sem dados" description="Gere o relatório para ver o resumo." />
  const { summary, charts } = data
  const empty =
    summary.result.income === 0 &&
    summary.result.expense === 0 &&
    charts.incomeVsExpense.length === 0
  if (empty) {
    return (
      <EmptyState
        title="Nenhuma movimentação no período"
        description="Não há receitas recebidas nem despesas pagas no período selecionado."
      />
    )
  }
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summary.cards.map((card) => (
          <MetricCard
            key={card.key}
            label={card.definition.label}
            value={card.value}
            hint={
              card.secondaryValue != null
                ? `${card.secondaryLabel ?? ""}: ${formatCurrency(card.secondaryValue)}`
                : undefined
            }
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{summary.result.label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-2xl font-semibold text-gray-900">
            {formatCurrency(summary.result.value)}
          </p>
          <p className="text-xs text-gray-500">{summary.result.definition}</p>
          <p className="text-xs text-gray-400">{summary.balanceNote}</p>
        </CardContent>
      </Card>

      {charts.incomeVsExpense.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Receitas x Despesas</CardTitle>
          </CardHeader>
          <CardContent>
            <FlowChart
              points={charts.incomeVsExpense.map((p) => ({
                key: p.key,
                label: p.label,
                income: p.income,
                expense: p.expense,
                net: p.income - p.expense,
              }))}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <BreakdownCard title="Receitas por forma" items={charts.incomeByMethod.map(toBreakdown)} />
        <BreakdownCard title="Receitas por procedimento" items={charts.incomeByProcedure.map(toBreakdown)} />
        <BreakdownCard title="Despesas por categoria" items={charts.expenseByCategory.map(toBreakdown)} />
      </div>
    </>
  )
}

function toBreakdown(item: { key: string; label: string; amount: number; sharePercent: number }): BreakdownItem {
  return { key: item.key, label: item.label, amount: item.amount, count: 0, sharePercent: item.sharePercent }
}

function BreakdownCard({ title, items }: { title: string; items: BreakdownItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-gray-400">Sem dados no período.</p>
        ) : (
          <div className="space-y-1">
            {items.map((i) => (
              <ShareBar
                key={i.key}
                label={i.label}
                amount={i.amount}
                sharePercent={i.sharePercent}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Aba: Receitas
// ---------------------------------------------------------------------------

function IncomeTab({ data }: { data: IncomeReport | null }) {
  if (!data) return <EmptyState title="Sem dados" description="Gere o relatório para ver as receitas." />
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Recebido" value={data.totalReceived} tone="positive" hint={`${data.receivedCount} recebimento(s)`} />
        <MetricCard label="Previsto (a receber)" value={data.totalPending} tone="warning" hint={`${data.pendingCount} pendente(s)`} />
        <MetricCard label="Ticket médio" value={data.averageTicket} />
        <MetricCard label="Parciais" value={data.partialCount} tone="neutral" />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="Nenhuma receita" description="Não há receitas no período selecionado." />
      ) : (
        <TableCard
          title="Recebimentos"
          columns={["Data", "Paciente", "Procedimentos", "Forma", "Valor"]}
          rows={data.rows.map((r) => [
            new Date(r.date).toLocaleDateString("pt-BR"),
            r.patientName,
            r.procedures || "—",
            r.paymentMethodLabel,
            formatCurrency(r.amount),
          ])}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Aba: Despesas
// ---------------------------------------------------------------------------

function ExpenseTab({ data }: { data: ExpenseReport | null }) {
  if (!data) return <EmptyState title="Sem dados" description="Gere o relatório para ver as despesas." />
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total de despesas" value={data.totalExpenses} />
        <MetricCard label="Pago" value={data.totalPaid} tone="negative" hint={`${data.paidCount} paga(s)`} />
        <MetricCard label="A pagar" value={data.totalPending} tone="warning" hint={`${data.pendingCount} pendente(s)`} />
        <MetricCard label="Vencido" value={data.totalOverdue} tone="negative" hint={`${data.overdueCount} vencida(s)`} />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="Nenhuma despesa" description="Não há despesas no período selecionado." />
      ) : (
        <TableCard
          title="Despesas"
          columns={["Descrição", "Categoria", "Fornecedor", "Vencimento", "Valor", "Pago", "Situação"]}
          rows={data.rows.map((r) => [
            r.description,
            r.categoryName,
            r.supplier ?? "—",
            r.dueDate ? new Date(r.dueDate).toLocaleDateString("pt-BR") : "—",
            formatCurrency(r.amount),
            formatCurrency(r.paidAmount),
            r.statusLabel,
          ])}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Aba: Fluxo de caixa
// ---------------------------------------------------------------------------

function CashFlowTab({ data }: { data: CashFlowReport | null }) {
  if (!data) return <EmptyState title="Sem dados" description="Gere o relatório para ver o fluxo de caixa." />
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Entradas" value={data.totalIncome} tone="positive" hint={`${data.incomeCount} entrada(s)`} />
        <MetricCard label="Saídas" value={data.totalExpense} tone="negative" hint={`${data.expenseCount} saída(s)`} />
        <MetricCard label="Saldo do período" value={data.periodBalance} />
        <MetricCard label="Saldo final" value={data.closingBalance} hint={`Saldo inicial: ${formatCurrency(data.openingBalance)}`} />
      </div>
      {data.series.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolução do caixa</CardTitle>
          </CardHeader>
          <CardContent>
            <FlowChart points={data.series.map((s) => ({ key: s.key, label: s.label, income: s.income, expense: s.expense, net: s.income - s.expense }))} />
          </CardContent>
        </Card>
      )}
      {data.rows.length === 0 ? (
        <EmptyState title="Sem movimentações" description="Não há entradas nem saídas no período." />
      ) : (
        <TableCard
          title="Movimentações"
          columns={["Data", "Tipo", "Origem", "Descrição", "Valor", "Saldo"]}
          rows={data.rows.map((r) => [
            new Date(r.date).toLocaleDateString("pt-BR"),
            r.typeLabel,
            r.originLabel,
            r.description,
            formatCurrency(r.amount),
            formatCurrency(r.runningBalance),
          ])}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Aba: A receber
// ---------------------------------------------------------------------------

function ReceivableTab({ data }: { data: ReceivableReport | null }) {
  if (!data) return <EmptyState title="Sem dados" description="Gere o relatório para ver as contas a receber." />
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Cobrado" value={data.totalCharged} />
        <MetricCard label="Recebido" value={data.totalReceived} tone="positive" />
        <MetricCard label="A receber" value={data.totalPending} tone="warning" hint={`${data.openCount} em aberto`} />
        <MetricCard label="Vencido" value={data.totalOverdue} tone="negative" hint={`${data.overdueCount} vencido(s)`} />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="Nada a receber" description="Não há contas a receber no período selecionado." />
      ) : (
        <TableCard
          title="Contas a receber"
          columns={["Paciente", "Procedimentos", "Vencimento", "Previsto", "Recebido", "Saldo", "Situação"]}
          rows={data.rows.map((r) => [
            r.patientName,
            r.procedures || "—",
            new Date(r.dueDate).toLocaleDateString("pt-BR"),
            formatCurrency(r.expectedAmount),
            formatCurrency(r.receivedAmount),
            formatCurrency(r.balance),
            r.statusLabel,
          ])}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Aba: Procedimentos
// ---------------------------------------------------------------------------

function ProcedureTab({ data }: { data: ProcedureReport | null }) {
  if (!data) return <EmptyState title="Sem dados" description="Gere o relatório para ver os procedimentos." />
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Cobrado" value={data.totalCharged} />
        <MetricCard label="Recebido" value={data.totalReceived} tone="positive" />
        <MetricCard label="A receber" value={data.totalPending} tone="warning" />
        <MetricCard label="Procedimentos" value={data.totalQuantity} tone="neutral" />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="Sem procedimentos" description="Nenhum procedimento com movimentação no período." />
      ) : (
        <TableCard
          title="Por procedimento"
          columns={["Procedimento", "Qtd.", "Cobrado", "Recebido", "% recebido"]}
          rows={data.rows.map((r) => [
            r.name,
            String(r.quantity),
            formatCurrency(r.chargedAmount),
            formatCurrency(r.receivedAmount),
            `${r.shareOfReceivedPercent.toFixed(1)}%`,
          ])}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Aba: Formas de pagamento
// ---------------------------------------------------------------------------

function PaymentMethodTab({ data }: { data: PaymentMethodReport | null }) {
  if (!data) return <EmptyState title="Sem dados" description="Gere o relatório para ver as formas de pagamento." />
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total recebido" value={data.totalReceived} tone="positive" />
        <MetricCard label="Recebimentos" value={data.totalCount} tone="neutral" />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="Sem recebimentos" description="Nenhum recebimento no período selecionado." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recebimentos por forma</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.rows.map((r) => (
              <ShareBar key={r.method} label={r.label} amount={r.amount} sharePercent={r.sharePercent} />
            ))}
          </CardContent>
        </Card>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Tabela genérica (apresentação)
// ---------------------------------------------------------------------------

function TableCard({
  title,
  columns,
  rows,
}: {
  title: string
  columns: string[]
  rows: string[][]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              {columns.map((c) => (
                <th key={c} className="px-4 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b border-gray-100 last:border-0">
                {row.map((cell, cidx) => (
                  <td key={cidx} className="px-4 py-2 text-gray-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

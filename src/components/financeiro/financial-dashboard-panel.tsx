"use client"

// ===========================================================================
// DASHBOARD FINANCEIRO — componente principal (Financeiro 1).
// ===========================================================================
// Consome `/api/financial/dashboard`. Nenhum cálculo financeiro acontece aqui:
// os totais chegam prontos do servidor. A UI apenas apresenta.
//
// TRANSPARÊNCIA (exigida pela regra "não inventar dados"):
//  - cards separam RECEBIDO de PREVISTO;
//  - contas a receber aparecem como PREVISÃO, nunca como receita;
//  - alertas de integridade expõem inconsistência real dos dados;
//  - período sem dados mostra R$ 0,00 e estado vazio explícito.

import { useCallback, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDateTime } from "@/lib/schemas"
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
  Receipt,
} from "lucide-react"
import { useAsyncData } from "@/lib/use-async-data"
import {
  EmptyState,
  FlowChart,
  MetricCard,
  ShareBar,
  TransactionStatusBadge,
} from "@/components/financeiro/financial-ui"
import type { FinancialDashboard } from "@/lib/financial-dashboard-service"
import type { ReceitasSummary } from "@/lib/financial-receitas-service"

// ---------------------------------------------------------------------------
// Períodos (a lista vive na UI; o cálculo vive no servidor)
// ---------------------------------------------------------------------------

const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "month", label: "Este mês" },
  { value: "year", label: "Este ano" },
]

const CATEGORY_COLORS = [
  "bg-blue-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-orange-400",
  "bg-rose-400",
  "bg-cyan-500",
  "bg-lime-500",
  "bg-indigo-500",
]

const METHOD_COLORS: Record<string, string> = {
  pix: "bg-teal-500",
  dinheiro: "bg-green-500",
  cartao_debito: "bg-blue-500",
  cartao_credito: "bg-violet-500",
  transferencia: "bg-cyan-500",
  outros: "bg-gray-400",
  nao_informado: "bg-gray-300",
}

function formatDateLabel(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("pt-BR")
}

export function FinancialDashboardPanel() {
  const [period, setPeriod] = useState("month")
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/financial/dashboard?period=${encodeURIComponent(period)}`
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || "Erro ao carregar o financeiro.")
    }
    return (await res.json()) as FinancialDashboard
  }, [period])

  // `refreshKey` permite ao botão "Atualizar" forçar uma nova busca.
  const { data, error, isLoading, reload } = useAsyncData<FinancialDashboard>(
    load,
    [load, refreshKey]
  )
  const loading = isLoading

  // Carregar sumário de receitas para o card de Receitas no Dashboard
  const loadSummary = useCallback(async () => {
    const params = new URLSearchParams({ period: period })
    const res = await fetch(`/api/financial/receitas?${params.toString()}`)
    if (!res.ok) return null
    const json = await res.json()
    return (json.summary ?? null) as ReceitasSummary | null
  }, [period])

  const { data: receitasSummary } = useAsyncData<ReceitasSummary | null>(
    loadSummary,
    [loadSummary, refreshKey]
  )

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
    void reload()
  }, [reload])

  // O período é navegável pela UI; o label vem calculado do servidor.
  const periodLabel = useMemo(() => {
    if (!data) return ""
    return `${formatDateLabel(data.period.start)} — ${formatDateLabel(data.period.end)}`
  }, [data])

  const hasIntegrityIssues = useMemo(() => {
    if (!data) return false
    return (
      data.integrity.overpaidAppointments.length > 0 ||
      data.integrity.declaredVsProceduresMismatch.length > 0
    )
  }, [data])

  const nothingInPeriod = useMemo(() => {
    if (!data) return true
    return (
      data.meta.transactionsConsidered === 0 &&
      data.accountsReceivable.count === 0
    )
  }, [data])

  return (
    <div className="space-y-6 p-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Financeiro</h1>
          <p className="mt-1 text-sm text-gray-500">
            Visão consolidada do fluxo de caixa — projeção dos registros reais.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Atualizar
          </Button>
        </div>
      </div>

      {/* Filtros de período */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
          {PERIOD_OPTIONS.map((option, index) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              className={
                "px-3.5 py-2 text-sm font-medium transition-colors " +
                (index > 0 ? "border-l border-gray-200 " : "") +
                (period === option.value
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-50")
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        {periodLabel ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <CalendarClock className="h-3.5 w-3.5" />
            {periodLabel}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : null}

      {data ? (
        <>
          {/* Cards principais */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Recebido"
              value={data.cash.received}
              hint={
                data.income.expected > 0
                  ? `+ ${formatCurrency(data.income.expected)} previstos no período`
                  : `Realizado no período · ${data.cash.settledCount} movimentações`
              }
              tone="positive"
              icon={<ArrowUpCircle className="h-5 w-5" />}
            />
            <MetricCard
              label="Despesas pagas"
              value={data.cash.paid}
              hint={
                data.expense.expected > 0
                  ? `+ ${formatCurrency(data.expense.expected)} previstas no período`
                  : "Saídas efetivadas no período"
              }
              tone="negative"
              icon={<ArrowDownCircle className="h-5 w-5" />}
            />
            <MetricCard
              label="Saldo do período"
              value={data.cash.net}
              hint={
                data.cash.expectedIn > 0 || data.cash.expectedOut > 0
                  ? `Projetado ${formatCurrency(data.cash.projectedNet)}`
                  : "Recebido menos pago"
              }
              tone={data.cash.net < 0 ? "negative" : "positive"}
              icon={<Scale className="h-5 w-5" />}
            />
            <MetricCard
              label="Contas a receber"
              value={data.accountsReceivable.total}
              hint={
                data.accountsReceivable.overdue > 0
                  ? `Vencido: ${formatCurrency(data.accountsReceivable.overdue)} · previsto, não recebido`
                  : `${data.accountsReceivable.count} atendimento(s) · previsto, não recebido`
              }
              tone="warning"
              icon={<Wallet className="h-5 w-5" />}
            />
            <MetricCard
              label="Receitas"
              value={receitasSummary?.totalReceived ?? data.cash.received}
              hint={receitasSummary ? `${receitasSummary.totalCount} recebimentos · ${receitasSummary.receivedCount} efetivados` : "Valores recebidos no período"}
              tone="positive"
              icon={<Receipt className="h-5 w-5" />}
            />
          </div>

          {/* Alerta de integridade — nunca escondido */}
          {hasIntegrityIssues ? (
            <Card className="border-amber-200 bg-amber-50/60">
              <CardContent className="p-5">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div className="min-w-0 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-900">
                        Verificações de integridade
                      </p>
                      <p className="mt-0.5 text-xs text-amber-800">
                        Registros reais que merecem conferência. Nada foi
                        corrigido automaticamente.
                      </p>
                    </div>

                    {data.integrity.overpaidAppointments.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-amber-900">
                          Recebido acima do valor previsto
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {data.integrity.overpaidAppointments.map((item) => (
                            <li
                              key={item.appointmentId}
                              className="text-xs text-amber-800"
                            >
                              <span className="font-medium">{item.patientName}</span>
                              {" — previsto "}
                              {formatCurrency(item.expected ?? 0)}
                              {", recebido "}
                              {formatCurrency(item.received ?? 0)}
                              {" (excedente "}
                              <span className="font-semibold">
                                {formatCurrency(item.overpaid ?? 0)}
                              </span>
                              {")"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {data.integrity.declaredVsProceduresMismatch.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-amber-900">
                          Valor do atendimento difere da soma dos procedimentos
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {data.integrity.declaredVsProceduresMismatch.map((item) => (
                            <li
                              key={item.appointmentId}
                              className="text-xs text-amber-800"
                            >
                              <span className="font-medium">{item.patientName}</span>
                              {" — total "}
                              {formatCurrency(item.declaredTotal ?? 0)}
                              {", procedimentos "}
                              {formatCurrency(item.proceduresTotal ?? 0)}
                              {" (diferença "}
                              {formatCurrency(item.diff ?? 0)}
                              {")"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Gráfico de fluxo */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Fluxo do período</CardTitle>
                <p className="mt-0.5 text-xs text-gray-500">
                  {data.series.granularity === "day"
                    ? "Agrupado por dia"
                    : "Agrupado por mês"}{" "}
                  · entradas e saídas por competência
                </p>
              </div>
              <div className="hidden items-center gap-4 text-xs sm:flex">
                <span className="inline-flex items-center gap-1 text-green-700">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {formatCurrency(data.income.total + data.income.expected)}
                </span>
                <span className="inline-flex items-center gap-1 text-red-700">
                  <TrendingDown className="h-3.5 w-3.5" />
                  {formatCurrency(data.expense.total + data.expense.expected)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <FlowChart points={data.series.points} />
            </CardContent>
          </Card>

          {/* Breakdowns */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Despesas por categoria</CardTitle>
                <p className="text-xs text-gray-500">
                  Somente categorias com movimentação no período.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.expensesByCategory.length === 0 ? (
                  <EmptyState
                    title="Nenhuma despesa no período"
                    description="Não há despesas registradas. O total é R$ 0,00 — nenhum valor é estimado."
                  />
                ) : (
                  data.expensesByCategory.map((slice, index) => (
                    <ShareBar
                      key={slice.categoryId}
                      label={slice.name}
                      amount={slice.amount}
                      sharePercent={slice.sharePercent}
                      color={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                      meta={`${slice.count} lançamento(s)`}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recebimentos por forma</CardTitle>
                <p className="text-xs text-gray-500">
                  Somente formas efetivamente utilizadas no período.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.incomeByMethod.length === 0 ? (
                  <EmptyState
                    title="Nenhum recebimento no período"
                    description="Não há pagamentos registrados. O total é R$ 0,00 — nenhum valor é estimado."
                  />
                ) : (
                  data.incomeByMethod.map((slice) => (
                    <ShareBar
                      key={slice.method}
                      label={slice.label}
                      amount={slice.amount}
                      sharePercent={slice.sharePercent}
                      color={METHOD_COLORS[slice.method] ?? "bg-gray-400"}
                      meta={`${slice.count} recebimento(s)`}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Movimentações recentes */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Movimentações recentes</CardTitle>
                <p className="mt-0.5 text-xs text-gray-500">
                  Últimos lançamentos do período, mais recentes primeiro.
                </p>
              </div>
              <Badge variant="default">
                {data.recentTransactions.length} de {data.meta.transactionsConsidered}
              </Badge>
            </CardHeader>
            <CardContent>
              {data.recentTransactions.length === 0 ? (
                <EmptyState
                  title="Sem movimentações no período"
                  description="Os recebimentos e despesas aparecem aqui conforme forem registrados."
                />
              ) : (
                <div className="-mx-2 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="px-2 py-2 font-medium">Data</th>
                        <th className="px-2 py-2 font-medium">Descrição</th>
                        <th className="px-2 py-2 font-medium">Paciente</th>
                        <th className="px-2 py-2 font-medium">Forma</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                        <th className="px-2 py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentTransactions.map((t) => (
                        <tr
                          key={t.id}
                          className="border-b border-gray-100 last:border-0"
                        >
                          <td className="whitespace-nowrap px-2 py-2.5 text-gray-600">
                            {formatDateTime(t.competenceDate)}
                          </td>
                          <td className="px-2 py-2.5">
                            <div className="flex items-center gap-2">
                              {t.direction === "in" ? (
                                <ArrowUpCircle className="h-4 w-4 shrink-0 text-green-600" />
                              ) : (
                                <ArrowDownCircle className="h-4 w-4 shrink-0 text-red-500" />
                              )}
                              <span className="truncate text-gray-800">
                                {t.description}
                              </span>
                              {t.overpaidAmount && t.overpaidAmount > 0 ? (
                                <span
                                  className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                                  title="Recebido acima do valor previsto neste atendimento"
                                >
                                  excedente
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-gray-600">
                            {t.patientName ?? "—"}
                          </td>
                          <td className="px-2 py-2.5 text-gray-600">
                            {t.paymentMethodLabel}
                          </td>
                          <td className="px-2 py-2.5">
                            <TransactionStatusBadge status={t.status} />
                          </td>
                          <td
                            className={
                              "whitespace-nowrap px-2 py-2.5 text-right font-medium tabular-nums " +
                              (t.direction === "in" ? "text-green-700" : "text-red-700")
                            }
                          >
                            {t.direction === "in" ? "+" : "−"}{" "}
                            {formatCurrency(t.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rodapé informativo — transparência do escopo desta fase */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-500">
            <span>
              {nothingInPeriod
                ? "Nenhuma movimentação nem conta a receber no período."
                : `${data.meta.transactionsConsidered} movimentação(ões) · ${data.meta.unpaidAppointmentsConsidered} atendimento(s) com saldo`}
            </span>
            <span className="inline-flex items-center gap-1">
              <ChevronLeft className="h-3 w-3" />
              Consolidado de pagamentos e despesas reais — valores previstos
              aparecem separados dos recebidos · Receitas detalhadas em /financeiro/receitas
              <ChevronRight className="h-3 w-3" />
            </span>
          </div>
        </>
      ) : null}
    </div>
  )
}

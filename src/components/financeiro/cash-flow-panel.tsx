"use client"

// ===========================================================================
// FLUXO DE CAIXA — painel do Financeiro (Financeiro 5).
// ===========================================================================
//
// Camada de APRESENTAÇÃO. Todo cálculo (totais, saldo do período, saldo
// acumulado, agrupamento por dia) vem pronto do servidor (fonte única:
// `financial-cash-flow-service.ts`). Esta tela:
//
//  - apresenta as ENTRADAS e SAÍDAS efetivamente realizadas;
//  - separa o SALDO DO PERÍODO do SALDO ACUMULADO (com nota de transparência);
//  - identifica entradas/saídas por TEXTO + ÍCONE + SINAL + BADGE (nunca só cor);
//  - filtra, busca e pagina NO SERVIDOR (nunca baixa a base inteira);
//  - abre o detalhe lateral com a origem (paciente/atendimento ou
//    fornecedor/categoria).

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Scale,
  Search,
  Wallet,
  X,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency } from "@/lib/schemas"
import { cn } from "@/lib/utils"
import { useAsyncData } from "@/lib/use-async-data"
import { EmptyState, FlowChart, MetricCard, ShareBar } from "@/components/financeiro/financial-ui"
import type {
  CashFlowDetail,
  CashFlowItem,
  CashFlowType,
  ListCashFlowResult,
} from "@/lib/financial-cash-flow-service"

// ---------------------------------------------------------------------------
// Opções de filtro (rótulos espelham o servidor)
// ---------------------------------------------------------------------------

const PERIOD_OPTIONS = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "month", label: "Este mês" },
  { value: "year", label: "Este ano" },
]

const TYPE_OPTIONS: { value: "ALL" | CashFlowType; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "INCOME", label: "Entradas" },
  { value: "EXPENSE", label: "Saídas" },
]

const METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: "pix", label: "PIX" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "cartao_debito", label: "Débito" },
  { value: "cartao_credito", label: "Crédito" },
  { value: "transferencia", label: "Transferência" },
  { value: "boleto", label: "Boleto" },
  { value: "outros", label: "Outros" },
]

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "PAYMENT", label: "Pagamento de paciente" },
  { value: "EXPENSE_PAYMENT", label: "Pagamento de despesa" },
]

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// ---------------------------------------------------------------------------
// Helpers de formatação (apenas apresentação)
// ---------------------------------------------------------------------------

/** Formata a data/hora efetiva (ISO) em "DD/MM/YYYY HH:MM". */
function formatMovementDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const year = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${day}/${month}/${year} ${hh}:${mm}`
}

/** Formata "YYYY-MM-DD" (chave de dia) em "DD/MM/YYYY". */
function formatDayKey(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value
}

/** Valor assinado com sinal matemático explícito (acessibilidade). */
function formatSignedAmount(type: CashFlowType, amount: number): string {
  const sign = type === "INCOME" ? "+" : "−"
  return `${sign} ${formatCurrency(amount)}`
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export function CashFlowPanel() {
  const [period, setPeriod] = useState("month")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [type, setType] = useState<"ALL" | CashFlowType>("ALL")
  const [paymentMethod, setPaymentMethod] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [source, setSource] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [view, setView] = useState<"list" | "daily">("list")

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CashFlowDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // Debounce da busca: 350 ms — evita uma consulta por tecla digitada.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchInput])

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    params.set("period", period)
    if (period === "custom") {
      if (from) params.set("from", from)
      if (to) params.set("to", to)
    }
    params.set("type", type)
    if (paymentMethod) params.set("paymentMethod", paymentMethod)
    if (categoryId) params.set("categoryId", categoryId)
    if (source) params.set("source", source)
    if (search) params.set("search", search)
    params.set("sort", "date")
    params.set("direction", "desc")
    params.set("page", String(page))
    params.set("pageSize", String(pageSize))

    const res = await fetch(`/api/financial/cash-flow?${params.toString()}`, {
      cache: "no-store",
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error ?? "Não foi possível carregar o fluxo de caixa.")
    return json as ListCashFlowResult
  }, [period, from, to, type, paymentMethod, categoryId, source, search, page, pageSize])

  const { data, error, isLoading, reload } = useAsyncData<ListCashFlowResult>(load, [load])

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id)
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    try {
      const res = await fetch(`/api/financial/cash-flow?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "Movimentação não encontrada.")
      setDetail(json.movement as CashFlowDetail)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Erro ao abrir a movimentação.")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const closeDetail = useCallback(() => {
    setDetailId(null)
    setDetail(null)
    setDetailError(null)
  }, [])

  const clearFilters = () => {
    setType("ALL")
    setPaymentMethod("")
    setCategoryId("")
    setSource("")
    setSearchInput("")
    setSearch("")
    setPage(1)
  }

  const totals = data?.totals
  const pagination = data?.pagination
  const hasActiveFilters = Boolean(type !== "ALL" || paymentMethod || categoryId || source || search)

  return (
    <div className="space-y-6">
      {/* Cabeçalho ------------------------------------------------------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Wallet className="h-6 w-6 text-blue-600" />
            Fluxo de Caixa
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Acompanhe as entradas, saídas e o saldo financeiro da clínica.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Atualizar
        </Button>
      </div>

      {/* Cards principais ----------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Entradas"
          value={totals?.totalIncome ?? 0}
          tone="positive"
          hint={totals ? `${totals.incomeCount} movimentação(ões)` : undefined}
          icon={<ArrowUpCircle className="h-5 w-5" />}
        />
        <MetricCard
          label="Saídas"
          value={totals?.totalExpense ?? 0}
          tone="negative"
          hint={totals ? `${totals.expenseCount} movimentação(ões)` : undefined}
          icon={<ArrowDownCircle className="h-5 w-5" />}
        />
        <MetricCard
          label="Saldo do período"
          value={totals?.periodBalance ?? 0}
          tone={(totals?.periodBalance ?? 0) < 0 ? "negative" : "default"}
          hint="Entradas − Saídas"
          icon={<Scale className="h-5 w-5" />}
        />
        <MetricCard
          label="Saldo acumulado"
          value={totals?.closingBalance ?? 0}
          tone="neutral"
          hint={totals ? `Abertura: ${formatCurrency(totals.openingBalance)}` : undefined}
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>

      {/* Nota de transparência sobre o saldo acumulado -------------------- */}
      <p className="text-xs text-gray-500">{data?.balanceNote?.message}</p>

      {/* Filtros --------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setPeriod(opt.value)
                  setPage(1)
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  period === opt.value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setPeriod("custom")
                setPage(1)
              }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                period === "custom"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              Personalizado
            </button>
          </div>

          {period === "custom" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-md">
              <div>
                <Label className="text-xs text-gray-500">De</Label>
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value)
                    setPage(1)
                  }}
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500">Até</Label>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value)
                    setPage(1)
                  }}
                />
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="text-xs text-gray-500">Busca</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  className="pl-9"
                  placeholder="Paciente, fornecedor, descrição, atendimento..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Tipo</Label>
              <select
                className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as "ALL" | CashFlowType)
                  setPage(1)
                }}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Forma de pagamento</Label>
              <select
                className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                value={paymentMethod}
                onChange={(e) => {
                  setPaymentMethod(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">Todas</option>
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Origem</Label>
              <select
                className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">Todas</option>
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Categoria (saídas) ----------------------------------------- */}
          {data && data.byCategory.length > 0 ? (
            <div>
              <Label className="text-xs text-gray-500">Categoria de saída</Label>
              <select
                className="h-10 w-full max-w-sm rounded-md border border-gray-200 bg-white px-3 text-sm"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">Todas</option>
                {data.byCategory.map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-2 h-4 w-4" />
              Limpar filtros
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* Gráfico e quebras ---------------------------------------------- */}
      {data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Entradas x Saídas</CardTitle>
            </CardHeader>
            <CardContent>
              <FlowChart points={data.series.points} />
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Por forma de pagamento</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.byMethod.length === 0 ? (
                  <EmptyState
                    title="Sem movimentações"
                    description="Nenhuma forma de pagamento registrada no período."
                  />
                ) : (
                  data.byMethod.map((m) => (
                    <ShareBar
                      key={m.method}
                      label={m.label}
                      amount={m.amount}
                      sharePercent={m.sharePercent}
                      meta={`${m.count} mov.`}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Saídas por categoria</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.byCategory.length === 0 ? (
                  <EmptyState
                    title="Sem saídas"
                    description="Nenhuma despesa paga no período."
                  />
                ) : (
                  data.byCategory.map((c) => (
                    <ShareBar
                      key={c.categoryId}
                      label={c.name}
                      amount={c.amount}
                      sharePercent={c.sharePercent}
                      color="bg-red-400"
                      meta={`${c.count} mov.`}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {/* Movimentações -------------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">
            Movimentações
            {pagination ? (
              <span className="ml-2 text-xs font-normal text-gray-500">
                {pagination.totalCount} registro(s)
              </span>
            ) : null}
          </CardTitle>

          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-gray-200 p-0.5">
              <button
                type="button"
                onClick={() => setView("list")}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium",
                  view === "list" ? "bg-blue-50 text-blue-700" : "text-gray-500"
                )}
              >
                Lista
              </button>
              <button
                type="button"
                onClick={() => setView("daily")}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium",
                  view === "daily" ? "bg-blue-50 text-blue-700" : "text-gray-500"
                )}
              >
                Por dia
              </button>
            </div>
            <Label className="text-xs text-gray-500">Por página</Label>
            <select
              className="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && !data ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : view === "daily" ? (
            <DailyView daily={data?.daily ?? []} hasActiveFilters={hasActiveFilters} />
          ) : data && data.movements.length === 0 ? (
            <EmptyState
              title="Nenhuma movimentação encontrada"
              description={
                hasActiveFilters
                  ? "Ajuste os filtros ou limpe a busca para ver mais resultados."
                  : "Assim que houver recebimentos ou pagamentos, o fluxo aparece aqui."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2">Origem</th>
                    <th className="px-3 py-2">Paciente / Fornecedor</th>
                    <th className="px-3 py-2">Método</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2 text-right">Saldo acum.</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data?.movements.map((item) => (
                    <MovementRow key={item.id} item={item} onOpen={openDetail} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginação ------------------------------------------------- */}
          {view === "list" && pagination && pagination.totalCount > 0 ? (
            <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-gray-100 pt-4 sm:flex-row">
              <p className="text-xs text-gray-500">
                Mostrando {pagination.from}–{pagination.to} de {pagination.totalCount}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasPrevious || isLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Anterior
                </Button>
                <span className="text-xs text-gray-600">
                  Página {pagination.page} de {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasNext || isLoading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {detailError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {detailError}
        </div>
      ) : null}

      {detailId ? (
        <MovementDrawer movement={detail} loading={detailLoading} onClose={closeDetail} />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha da tabela
// ---------------------------------------------------------------------------

function MovementRow({
  item,
  onOpen,
}: {
  item: CashFlowItem
  onOpen: (id: string) => void
}) {
  const isIncome = item.type === "INCOME"
  return (
    <tr
      className="cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50"
      onClick={() => onOpen(item.id)}
    >
      <td className="whitespace-nowrap px-3 py-3 text-gray-700">
        {formatMovementDate(item.date)}
      </td>
      <td className="px-3 py-3">
        <TypeBadge type={item.type} status={item.status} />
      </td>
      <td className="max-w-[240px] px-3 py-3">
        <p className="truncate font-medium text-gray-900" title={item.description}>
          {item.description}
        </p>
        {item.appointmentCode ? (
          <p className="text-[11px] text-gray-400">Atendimento #{item.appointmentCode}</p>
        ) : null}
      </td>
      <td className="px-3 py-3 text-gray-600">{item.sourceLabel}</td>
      <td className="max-w-[200px] truncate px-3 py-3 text-gray-700">
        {isIncome ? item.patientName ?? "—" : item.supplier ?? "—"}
      </td>
      <td className="px-3 py-3 text-gray-700">{item.paymentMethodLabel}</td>
      <td
        className={cn(
          "whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums",
          isIncome ? "text-green-700" : "text-red-700"
        )}
      >
        {formatSignedAmount(item.type, item.amount)}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-gray-600">
        {formatCurrency(item.runningBalance)}
      </td>
      <td className="px-3 py-3 text-right text-gray-300">
        <ChevronRight className="h-4 w-4" />
      </td>
    </tr>
  )
}

/**
 * Badge de tipo. Não depende só de cor: traz ícone + texto (ENTRADA/SAÍDA) e,
 * quando estornado, o status textual adicional.
 */
function TypeBadge({ type, status }: { type: CashFlowType; status: string }) {
  const isIncome = type === "INCOME"
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
          isIncome ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
        )}
      >
        {isIncome ? (
          <ArrowUpCircle className="h-3 w-3" />
        ) : (
          <ArrowDownCircle className="h-3 w-3" />
        )}
        {isIncome ? "ENTRADA" : "SAÍDA"}
      </span>
      {status === "reversed" ? (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
          Estornado
        </span>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Visualização agrupada por dia
// ---------------------------------------------------------------------------

function DailyView({
  daily,
  hasActiveFilters,
}: {
  daily: ListCashFlowResult["daily"]
  hasActiveFilters: boolean
}) {
  if (daily.length === 0) {
    return (
      <EmptyState
        title="Nenhuma movimentação no período"
        description={
          hasActiveFilters
            ? "Ajuste os filtros ou limpe a busca para ver mais resultados."
            : "Assim que houver recebimentos ou pagamentos, o resumo diário aparece aqui."
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {daily.map((day) => (
        <div key={day.dayKey} className="rounded-lg border border-gray-100 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-gray-900">{formatDayKey(day.date)}</p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1.5 text-green-700">
                <ArrowUpCircle className="h-4 w-4" />
                Entradas <span className="font-semibold">+ {formatCurrency(day.income)}</span>
                <span className="text-[11px] text-gray-400">({day.incomeCount})</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-red-700">
                <ArrowDownCircle className="h-4 w-4" />
                Saídas <span className="font-semibold">− {formatCurrency(day.expense)}</span>
                <span className="text-[11px] text-gray-400">({day.expenseCount})</span>
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 font-semibold",
                  day.net < 0 ? "text-red-700" : "text-gray-900"
                )}
              >
                Saldo do dia{" "}
                <span className="tabular-nums">
                  {day.net >= 0 ? "+" : "−"} {formatCurrency(Math.abs(day.net))}
                </span>
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawer de detalhe
// ---------------------------------------------------------------------------

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-0.5">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="text-right text-gray-900">{children}</span>
    </div>
  )
}

function MovementDrawer({
  movement,
  loading,
  onClose,
}: {
  movement: CashFlowDetail | null
  loading: boolean
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const isIncome = movement?.type === "INCOME"

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            {isIncome ? (
              <ArrowUpCircle className="h-4 w-4 text-green-600" />
            ) : (
              <ArrowDownCircle className="h-4 w-4 text-red-600" />
            )}
            {isIncome ? "Entrada" : "Saída"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !movement ? (
          <div className="p-5 text-sm text-gray-500">Movimentação não encontrada.</div>
        ) : (
          <div className="flex-1 space-y-5 p-5">
            {/* Valor e data --------------------------------------------- */}
            <div className="rounded-lg bg-gray-50 p-4">
              <p
                className={cn(
                  "text-2xl font-bold tabular-nums",
                  isIncome ? "text-green-700" : "text-red-700"
                )}
              >
                {formatSignedAmount(movement.type, movement.amount)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {formatMovementDate(movement.date)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <TypeBadge type={movement.type} status={movement.status} />
                <span className="text-[11px] text-gray-500">{movement.sourceLabel}</span>
              </div>
            </div>

            {/* Contexto ------------------------------------------------- */}
            <section className="space-y-2 text-sm">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Detalhes
              </h3>

              {isIncome ? (
                <>
                  <DetailRow label="Paciente">{movement.patientName ?? "—"}</DetailRow>
                  <DetailRow label="Atendimento">
                    {movement.appointmentCode ? `#${movement.appointmentCode}` : "—"}
                  </DetailRow>
                  {movement.professionalName ? (
                    <DetailRow label="Profissional">{movement.professionalName}</DetailRow>
                  ) : null}
                  {movement.originContext.expectedTotal != null ? (
                    <DetailRow label="Valor previsto">
                      {formatCurrency(movement.originContext.expectedTotal)}
                    </DetailRow>
                  ) : null}
                  {movement.originContext.receivedTotal != null ? (
                    <DetailRow label="Total recebido">
                      {formatCurrency(movement.originContext.receivedTotal)}
                    </DetailRow>
                  ) : null}
                  {movement.originContext.pendingTotal != null ? (
                    <DetailRow label="Saldo em aberto">
                      {formatCurrency(movement.originContext.pendingTotal)}
                    </DetailRow>
                  ) : null}
                </>
              ) : (
                <>
                  <DetailRow label="Descrição">{movement.description}</DetailRow>
                  <DetailRow label="Categoria">{movement.categoryName ?? "—"}</DetailRow>
                  <DetailRow label="Fornecedor">{movement.supplier ?? "—"}</DetailRow>
                  {movement.originContext.expenseAmount != null ? (
                    <DetailRow label="Valor da despesa">
                      {formatCurrency(movement.originContext.expenseAmount)}
                    </DetailRow>
                  ) : null}
                  {movement.originContext.expenseBalance != null ? (
                    <DetailRow label="Saldo da despesa">
                      {formatCurrency(movement.originContext.expenseBalance)}
                    </DetailRow>
                  ) : null}
                  {movement.originContext.documentNumber ? (
                    <DetailRow label="Documento">
                      {movement.originContext.documentNumber}
                    </DetailRow>
                  ) : null}
                </>
              )}

              <DetailRow label="Método">{movement.paymentMethodLabel}</DetailRow>
              <DetailRow label="Saldo acumulado">
                {formatCurrency(movement.runningBalance)}
              </DetailRow>
              {movement.reversedAt ? (
                <DetailRow label="Estornado em">
                  {formatMovementDate(movement.reversedAt)}
                </DetailRow>
              ) : null}
            </section>

            {/* Procedimentos (entradas) -------------------------------- */}
            {isIncome && movement.procedures.length > 0 ? (
              <section className="space-y-2 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Procedimentos
                </h3>
                {movement.procedures.map((p, i) => (
                  <div
                    key={`${p.name}-${i}`}
                    className="flex items-start justify-between gap-4 rounded-md border border-gray-100 px-3 py-2"
                  >
                    <span className="text-gray-700">
                      {p.name}
                      {p.quantity > 1 ? (
                        <span className="text-xs text-gray-400"> × {p.quantity}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-gray-900">
                      {formatCurrency(p.totalPrice)}
                    </span>
                  </div>
                ))}
              </section>
            ) : null}

            {/* Histórico de pagamentos da origem ----------------------- */}
            {movement.relatedPayments.length > 0 ? (
              <section className="space-y-2 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {isIncome ? "Pagamentos do atendimento" : "Pagamentos da despesa"}
                </h3>
                {movement.relatedPayments.map((p) => (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
                      p.isCurrent ? "border-blue-200 bg-blue-50" : "border-gray-100"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-gray-700">{p.paymentMethodLabel}</p>
                      <p className="text-[11px] text-gray-400">
                        {formatMovementDate(p.paidAt)}
                        {p.isCurrent ? " · esta movimentação" : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 font-medium tabular-nums",
                        isIncome ? "text-green-700" : "text-red-700"
                      )}
                    >
                      {isIncome ? "+" : "−"} {formatCurrency(p.amount)}
                    </span>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  )
}


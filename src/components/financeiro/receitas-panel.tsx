"use client"

// ===========================================================================
// RECEITAS — painel do Financeiro (Financeiro 2).
// ===========================================================================
// Camada de APRESENTAÇÃO. Todo cálculo (totais, ticket médio, saldo, status
// derivado) vem pronto do servidor. Esta tela:
//
//  - filtra, busca, ordena e pagina NO SERVIDOR (nunca baixa a base inteira);
//  - mostra o valor EFETIVAMENTE RECEBIDO como protagonista e o saldo apenas
//    como contexto (nunca somando previsto ao recebido);
//  - não afirma identidade: "Responsável" é atribuição textual, não login.

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowUpCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  X,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatDateTime } from "@/lib/schemas"
import { cn } from "@/lib/utils"
import { useAsyncData } from "@/lib/use-async-data"
import { EmptyState, MetricCard } from "@/components/financeiro/financial-ui"
import type {
  ListReceitasResult,
  ReceitaDetail,
  ReceitaItem,
} from "@/lib/financial-receitas-service"

// ---------------------------------------------------------------------------
// Opções de filtro (rótulos espelham o servidor)
// ---------------------------------------------------------------------------

const PERIOD_OPTIONS = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "month", label: "Este mês" },
  { value: "year", label: "Este ano" },
  { value: "all", label: "Tudo" },
]

const STATUS_OPTIONS = [
  { value: "settled", label: "Recebido" },
  { value: "partial", label: "Parcial" },
  { value: "pending", label: "Previsto" },
  { value: "cancelled", label: "Cancelado" },
  { value: "reversed", label: "Estornado" },
]

const METHOD_OPTIONS = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "PIX" },
  { value: "cartao_debito", label: "Cartão de Débito" },
  { value: "cartao_credito", label: "Cartão de Crédito" },
  { value: "transferencia", label: "Transferência" },
  { value: "boleto", label: "Boleto" },
  { value: "outros", label: "Outros" },
]

const ORIGIN_OPTIONS = [
  { value: "appointment", label: "Atendimento" },
  { value: "schedule", label: "Agendamento" },
]

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const STATUS_BADGE: Record<string, string> = {
  settled: "bg-green-100 text-green-800",
  partial: "bg-blue-100 text-blue-800",
  pending: "bg-amber-100 text-amber-800",
  cancelled: "bg-gray-100 text-gray-600",
  reversed: "bg-red-100 text-red-800",
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export function ReceitasPanel() {
  const [period, setPeriod] = useState("month")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [status, setStatus] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("")
  const [origin, setOrigin] = useState("")
  const [professionalName, setProfessionalName] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<"date" | "amount" | "patient">("date")
  const [direction, setDirection] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [detail, setDetail] = useState<ReceitaDetail | null>(null)
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

  // A listagem é carregada pelo `useAsyncData`: todo `setState` acontece após o
  // primeiro `await`, evitando renderização em cascata no efeito.
  const load = useCallback(async () => {
    const params = new URLSearchParams()
    params.set("period", period)
    if (period === "custom") {
      if (from) params.set("from", from)
      if (to) params.set("to", to)
    }
    if (status) params.set("status", status)
    if (paymentMethod) params.set("paymentMethod", paymentMethod)
    if (origin) params.set("origin", origin)
    if (professionalName.trim()) params.set("professionalName", professionalName.trim())
    if (search) params.set("search", search)
    params.set("sort", sort)
    params.set("direction", direction)
    params.set("page", String(page))
    params.set("pageSize", String(pageSize))

    const res = await fetch(`/api/financial/receitas?${params.toString()}`, {
      cache: "no-store",
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error ?? "Não foi possível carregar as receitas.")
    return json as ListReceitasResult
  }, [
    period,
    from,
    to,
    status,
    paymentMethod,
    origin,
    professionalName,
    search,
    sort,
    direction,
    page,
    pageSize,
  ])

  const { data, error, isLoading, reload } = useAsyncData<ListReceitasResult>(
    load,
    [load]
  )
  const loading = isLoading

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    try {
      const res = await fetch(`/api/financial/receitas/${id}`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "Receita não encontrada.")
      setDetail(json as ReceitaDetail)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Erro ao abrir a receita.")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const clearFilters = () => {
    setStatus("")
    setPaymentMethod("")
    setOrigin("")
    setProfessionalName("")
    setSearchInput("")
    setSearch("")
    setPage(1)
  }

  const toggleSort = (field: "date" | "amount" | "patient") => {
    if (sort === field) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSort(field)
      setDirection(field === "patient" ? "asc" : "desc")
    }
    setPage(1)
  }

  const summary = data?.summary
  const pagination = data?.pagination
  const hasActiveFilters = Boolean(
    status || paymentMethod || origin || professionalName || search
  )

  return (
    <div className="space-y-6">
      {/* Cabeçalho ------------------------------------------------------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <ArrowUpCircle className="h-6 w-6 text-green-600" />
            Receitas
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Valores efetivamente recebidos, por atendimento. Recebimentos parciais
            aparecem pelo valor pago.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Atualizar
          </Button>
        </div>
      </div>

      {/* Cartões de resumo ---------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Recebido no período"
          value={summary?.totalReceived ?? 0}
          tone="positive"
          hint={
            summary
              ? `${summary.receivedCount} recebimento(s) · ${summary.partialCount} parcial(is)`
              : undefined
          }
          icon={<ArrowUpCircle className="h-5 w-5" />}
        />
        <MetricCard
          label="Recebido hoje"
          value={summary?.receivedToday ?? 0}
          tone="neutral"
          hint="Sempre o dia corrente, independente do filtro"
        />
        <MetricCard
          label="Ticket médio"
          value={summary?.averageTicket ?? 0}
          hint={
            summary && summary.receivedCount > 0
              ? `Média de ${summary.receivedCount} recebimento(s)`
              : "Sem recebimentos no período"
          }
        />
        <MetricCard
          label="Saldo em aberto"
          value={summary?.totalPending ?? 0}
          tone="warning"
          hint={
            summary
              ? `${summary.pendingCount} previsto(s) — não é receita`
              : "Não é receita recebida"
          }
        />
      </div>

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
                    ? "bg-green-600 text-white"
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
                  ? "bg-green-600 text-white"
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
                  placeholder="Paciente, CPF, atendimento, procedimento..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs text-gray-500">Status</Label>
              <select
                className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">Todos</option>
                {STATUS_OPTIONS.map((o) => (
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
                value={origin}
                onChange={(e) => {
                  setOrigin(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">Todas</option>
                {ORIGIN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-64">
              <Label className="text-xs text-gray-500">Profissional</Label>
              <Input
                placeholder="Nome do responsável"
                value={professionalName}
                onChange={(e) => {
                  setProfessionalName(e.target.value)
                  setPage(1)
                }}
              />
            </div>

            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-2 h-4 w-4" />
                Limpar filtros
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Tabela ---------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">
            Recebimentos
            {pagination ? (
              <span className="ml-2 text-xs font-normal text-gray-500">
                {pagination.totalCount} registro(s)
              </span>
            ) : null}
          </CardTitle>

          <div className="flex items-center gap-2">
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
          {error ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {loading && !data ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : data && data.receitas.length === 0 ? (
            <EmptyState
              title="Nenhuma receita encontrada"
              description={
                hasActiveFilters
                  ? "Ajuste os filtros ou limpe a busca para ver mais resultados."
                  : "Assim que houver recebimentos registrados, eles aparecem aqui."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        onClick={() => toggleSort("date")}
                      >
                        Data
                        {sort === "date" ? (direction === "asc" ? " ▲" : " ▼") : null}
                      </button>
                    </th>
                    <th className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        onClick={() => toggleSort("patient")}
                      >
                        Paciente
                        {sort === "patient" ? (direction === "asc" ? " ▲" : " ▼") : null}
                      </button>
                    </th>
                    <th className="px-3 py-2">Atendimento</th>
                    <th className="px-3 py-2">Procedimentos</th>
                    <th className="px-3 py-2">Forma</th>
                    <th className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        onClick={() => toggleSort("amount")}
                      >
                        Recebido
                        {sort === "amount" ? (direction === "asc" ? " ▲" : " ▼") : null}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.receitas.map((item) => (
                    <ReceitaRow key={item.id} item={item} onOpen={openDetail} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginação ------------------------------------------------- */}
          {pagination && pagination.totalCount > 0 ? (
            <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-gray-100 pt-4 sm:flex-row">
              <p className="text-xs text-gray-500">
                Mostrando {pagination.from}–{pagination.to} de {pagination.totalCount}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasPrevious || loading}
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
                  disabled={!pagination.hasNext || loading}
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

      {/* Erro ao abrir o detalhe ---------------------------------------- */}
      {detailError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {detailError}
        </div>
      ) : null}

      {/* Drawer de detalhe ---------------------------------------------- */}
      {detail || detailLoading ? (
        <ReceitaDrawer
          receita={detail}
          loading={detailLoading}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha da tabela
// ---------------------------------------------------------------------------

function ReceitaRow({
  item,
  onOpen,
}: {
  item: ReceitaItem
  onOpen: (id: string) => void
}) {
  const proceduresText =
    item.procedures.length > 0 ? item.procedures.map((p) => p.name).join(", ") : "—"

  return (
    <tr
      className="cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50"
      onClick={() => onOpen(item.id)}
    >
      <td className="whitespace-nowrap px-3 py-3 text-gray-700">
        {item.receivedAt ? formatDateTime(item.receivedAt) : "—"}
      </td>
      <td className="px-3 py-3">
        <p className="font-medium text-gray-900">{item.patientName}</p>
        {item.patientCpf ? (
          <p className="text-xs text-gray-500">{item.patientCpf}</p>
        ) : null}
      </td>
      <td className="px-3 py-3">
        {item.appointmentCode ? (
          <span className="font-mono text-xs text-gray-600">{item.appointmentCode}</span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
        <p className="text-[11px] text-gray-400">{item.originLabel}</p>
      </td>
      <td className="max-w-[240px] px-3 py-3">
        <p className="truncate text-gray-700" title={proceduresText}>
          {proceduresText}
        </p>
      </td>
      <td className="px-3 py-3 text-gray-700">{item.paymentMethodLabel}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-green-700">
        {formatCurrency(item.amount)}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-gray-600">
        {item.pendingTotal > 0 ? formatCurrency(item.pendingTotal) : "—"}
      </td>
      <td className="px-3 py-3">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            STATUS_BADGE[item.status] ?? "bg-gray-100 text-gray-700"
          )}
        >
          {item.statusLabel}
        </span>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Drawer de detalhe
// ---------------------------------------------------------------------------

function ReceitaDrawer({
  receita,
  loading,
  onClose,
}: {
  receita: ReceitaDetail | null
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <Receipt className="h-4 w-4 text-green-600" />
            Detalhe da receita
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

        {loading || !receita ? (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5 px-5 py-5">
            <section>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Paciente
              </p>
              <p className="mt-1 text-lg font-semibold text-gray-900">
                {receita.patientName}
              </p>
              <p className="text-sm text-gray-500">
                {[receita.patientCpf, receita.patientPhone].filter(Boolean).join(" · ") ||
                  "Sem contato cadastrado"}
              </p>
            </section>

            <section className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Recebido
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums text-green-700">
                  {formatCurrency(receita.amount)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Saldo em aberto
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums text-amber-700">
                  {formatCurrency(receita.pendingTotal)}
                </p>
              </div>
            </section>

            <section className="rounded-lg bg-gray-50 p-4 text-sm">
              <div className="flex justify-between py-0.5">
                <span className="text-gray-500">Total previsto do atendimento</span>
                <span className="tabular-nums text-gray-900">
                  {formatCurrency(receita.expectedTotal)}
                </span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-gray-500">Total recebido no atendimento</span>
                <span className="tabular-nums text-gray-900">
                  {formatCurrency(receita.receivedTotal)}
                </span>
              </div>
            </section>

            <section className="space-y-2 text-sm">
              <Row label="Data do recebimento">
                {receita.receivedAt ? formatDateTime(receita.receivedAt) : "—"}
              </Row>
              <Row label="Registrado em">{formatDateTime(receita.createdAt)}</Row>
              <Row label="Forma de pagamento">{receita.paymentMethodLabel}</Row>
              <Row label="Status">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                    STATUS_BADGE[receita.status] ?? "bg-gray-100 text-gray-700"
                  )}
                >
                  {receita.statusLabel}
                </span>
              </Row>
              <Row label="Origem">{receita.originLabel}</Row>
              {receita.appointmentCode ? (
                <Row label="Atendimento">
                  <span className="font-mono text-xs">{receita.appointmentCode}</span>
                  {receita.appointmentDate ? ` · ${receita.appointmentDate.slice(0, 10)}` : ""}
                  {receita.appointmentTime ? ` ${receita.appointmentTime}` : ""}
                </Row>
              ) : null}
              <Row label="Profissional">{receita.professionalName ?? "—"}</Row>
              <Row label="Registrado por">{receita.createdByName ?? "Não informado"}</Row>
            </section>

            {receita.procedures.length > 0 ? (
              <section>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Procedimentos
                </p>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {receita.procedures.map((p, i) => (
                    <li
                      key={`${p.name}-${i}`}
                      className="flex justify-between px-3 py-2 text-sm"
                    >
                      <span className="text-gray-700">
                        {p.quantity}× {p.name}
                      </span>
                      <span className="tabular-nums text-gray-900">
                        {formatCurrency(p.totalPrice)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {receita.payments.length > 0 ? (
              <section>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Pagamentos do atendimento
                </p>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {receita.payments.map((p) => (
                    <li
                      key={p.id}
                      className={cn(
                        "flex items-center justify-between px-3 py-2 text-sm",
                        p.isCurrent && "bg-green-50/60"
                      )}
                    >
                      <span className="text-gray-700">
                        {p.paidAt ? formatDateTime(p.paidAt) : formatDateTime(p.createdAt)}
                        <span className="ml-2 text-xs text-gray-500">
                          {p.paymentMethodLabel}
                          {p.status === "refunded" ? " · estornado" : ""}
                        </span>
                      </span>
                      <span className="tabular-nums text-gray-900">
                        {formatCurrency(p.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {receita.status === "reversed" ? (
              <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <p className="font-medium">Receita estornada</p>
                <p className="mt-1 text-xs">
                  {receita.reversedAt ? formatDateTime(receita.reversedAt) : ""}
                  {receita.reversedByName ? ` · por ${receita.reversedByName}` : ""}
                </p>
                {receita.reverseReason ? (
                  <p className="mt-1 text-xs">Motivo: {receita.reverseReason}</p>
                ) : null}
                <p className="mt-2 text-xs">
                  Este valor está fora de todos os totais de receita.
                </p>
              </section>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-50 py-1.5">
      <span className="text-gray-500">{label}</span>
      <span className="text-right text-gray-900">{children}</span>
    </div>
  )
}

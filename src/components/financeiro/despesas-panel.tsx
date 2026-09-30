"use client"

// ===========================================================================
// DESPESAS — painel do Financeiro (Financeiro 4).
// ===========================================================================
// Camada de APRESENTAÇÃO. Todo cálculo (totais, saldo, status derivado) vem
// pronto do servidor (fonte única: `financial-expense-service.ts`). Esta tela:
//
//  - filtra, busca, ordena e pagina NO SERVIDOR (nunca baixa a base inteira);
//  - mostra o SALDO EM ABERTO como o que ainda vai sair do caixa e o valor
//    efetivamente PAGO como contexto — nunca somando previsto ao pago;
//  - não afirma identidade: "Responsável" é atribuição textual, não login;
//  - não exclui despesa: cancela (despesas são registros contábeis).

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowDownCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
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
import {
  DESPESA_PAYMENT_METHODS,
  DESPESA_STATUS_COLORS,
} from "@/lib/financial-expense-service"
import type {
  DespesaDetail,
  DespesaItem,
  DespesaStatus,
  ListDespesasResult,
} from "@/lib/financial-expense-service"

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

const STATUS_OPTIONS: { value: DespesaStatus; label: string }[] = [
  { value: "PENDENTE", label: "Pendente" },
  { value: "PARCIAL", label: "Parcial" },
  { value: "PAGA", label: "Paga" },
  { value: "VENCIDA", label: "Vencida" },
  { value: "CANCELADA", label: "Cancelada" },
]

const METHOD_LABELS: Record<string, string> = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferência",
  boleto: "Boleto",
  outros: "Outros",
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// ---------------------------------------------------------------------------
// Helpers de data (apenas formatação — nenhum cálculo financeiro)
// ---------------------------------------------------------------------------

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—"
  // Valores YYYY-MM-DD (competência/vencimento) não têm fuso: formatar direto
  // evita o deslocamento de um dia que `new Date()` causaria.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return formatDateTime(value).split(",")[0]
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export function DespesasPanel() {
  const [period, setPeriod] = useState("month")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [status, setStatus] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<
    "dueDate" | "amount" | "description" | "supplier" | "competenceDate"
  >("dueDate")
  const [direction, setDirection] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DespesaDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)

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
    if (status) params.set("status", status)
    if (paymentMethod) params.set("paymentMethod", paymentMethod)
    if (search) params.set("search", search)
    params.set("sort", sort)
    params.set("direction", direction)
    params.set("page", String(page))
    params.set("pageSize", String(pageSize))

    const res = await fetch(`/api/financial/despesas?${params.toString()}`, {
      cache: "no-store",
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error ?? "Não foi possível carregar as despesas.")
    return json as ListDespesasResult
  }, [period, from, to, status, paymentMethod, search, sort, direction, page, pageSize])

  const { data, error, isLoading, reload } = useAsyncData<ListDespesasResult>(load, [load])

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id)
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    try {
      const res = await fetch(`/api/financial/despesas?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "Despesa não encontrada.")
      setDetail(json.despesa as DespesaDetail)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Erro ao abrir a despesa.")
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
    setStatus("")
    setPaymentMethod("")
    setSearchInput("")
    setSearch("")
    setPage(1)
  }

  const toggleSort = (
    field: "dueDate" | "amount" | "description" | "supplier" | "competenceDate"
  ) => {
    if (sort === field) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSort(field)
      setDirection(field === "amount" ? "desc" : "asc")
    }
    setPage(1)
  }

  const summary = data?.summary
  const pagination = data?.pagination
  const hasActiveFilters = Boolean(status || paymentMethod || search)

  return (
    <div className="space-y-6">
      {/* Cabeçalho ------------------------------------------------------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <ArrowDownCircle className="h-6 w-6 text-red-600" />
            Despesas
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Saídas do caixa por competência. O saldo em aberto é o que ainda vai sair; o
            pago já saiu.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Atualizar
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova despesa
          </Button>
        </div>
      </div>

      {/* Cartões de resumo ---------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total no período"
          value={summary?.totalExpenses ?? 0}
          tone="default"
          hint={summary ? `${summary.totalCount} despesa(s)` : undefined}
          icon={<ArrowDownCircle className="h-5 w-5" />}
        />
        <MetricCard
          label="Pago"
          value={summary?.totalPaid ?? 0}
          tone="negative"
          hint={summary ? `${summary.paidCount} quitada(s)` : undefined}
        />
        <MetricCard
          label="Em aberto"
          value={summary?.totalPending ?? 0}
          tone="warning"
          hint={summary ? `${summary.pendingCount} pendente(s)` : undefined}
        />
        <MetricCard
          label="Vencidas"
          value={summary?.totalOverdue ?? 0}
          tone="negative"
          hint={summary ? `${summary.overdueCount} vencida(s)` : undefined}
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
                    ? "bg-red-600 text-white"
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
                  ? "bg-red-600 text-white"
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
                  placeholder="Descrição, fornecedor, observação..."
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
                {DESPESA_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {METHOD_LABELS[m] ?? m}
                  </option>
                ))}
              </select>
            </div>

            {hasActiveFilters ? (
              <div className="flex items-end">
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="mr-2 h-4 w-4" />
                  Limpar filtros
                </Button>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Tabela ---------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">
            Despesas
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

          {isLoading && !data ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : data && data.despesas.length === 0 ? (
            <EmptyState
              title="Nenhuma despesa encontrada"
              description={
                hasActiveFilters
                  ? "Ajuste os filtros ou limpe a busca para ver mais resultados."
                  : "Cadastre a primeira despesa para acompanhar as saídas do caixa."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        onClick={() => toggleSort("competenceDate")}
                      >
                        Competência
                        {sort === "competenceDate"
                          ? direction === "asc"
                            ? " ▲"
                            : " ▼"
                          : null}
                      </button>
                    </th>
                    <th className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        onClick={() => toggleSort("description")}
                      >
                        Descrição
                        {sort === "description" ? (direction === "asc" ? " ▲" : " ▼") : null}
                      </button>
                    </th>
                    <th className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        onClick={() => toggleSort("supplier")}
                      >
                        Fornecedor
                        {sort === "supplier" ? (direction === "asc" ? " ▲" : " ▼") : null}
                      </button>
                    </th>
                    <th className="px-3 py-2">Categoria</th>
                    <th className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        onClick={() => toggleSort("dueDate")}
                      >
                        Vencimento
                        {sort === "dueDate" ? (direction === "asc" ? " ▲" : " ▼") : null}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        onClick={() => toggleSort("amount")}
                      >
                        Valor
                        {sort === "amount" ? (direction === "asc" ? " ▲" : " ▼") : null}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">Pago</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.despesas.map((item) => (
                    <DespesaRow key={item.id} item={item} onOpen={openDetail} />
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

      {/* Erro ao abrir o detalhe ---------------------------------------- */}
      {detailError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {detailError}
        </div>
      ) : null}

      {/* Drawer de detalhe ---------------------------------------------- */}
      {detailId ? (
        <DespesaDrawer
          despesa={detail}
          loading={detailLoading}
          onClose={closeDetail}
          onChanged={() => {
            void reload()
          }}
        />
      ) : null}

      {/* Drawer de criação ---------------------------------------------- */}
      {createOpen ? (
        <DespesaCreateDrawer
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            void reload()
          }}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha da tabela
// ---------------------------------------------------------------------------

function DespesaRow({
  item,
  onOpen,
}: {
  item: DespesaItem
  onOpen: (id: string) => void
}) {
  return (
    <tr
      className="cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50"
      onClick={() => onOpen(item.id)}
    >
      <td className="whitespace-nowrap px-3 py-3 text-gray-700">
        {formatDateOnly(item.competenceDate)}
      </td>
      <td className="max-w-[240px] px-3 py-3">
        <p className="truncate font-medium text-gray-900" title={item.description}>
          {item.description}
        </p>
      </td>
      <td className="px-3 py-3 text-gray-700">{item.supplier ?? "—"}</td>
      <td className="px-3 py-3 text-gray-700">{item.categoryName}</td>
      <td className="whitespace-nowrap px-3 py-3 text-gray-700">
        {item.dueDate ? formatDateOnly(item.dueDate) : "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-gray-900">
        {formatCurrency(item.amount)}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-gray-600">
        {item.paidAmount > 0 ? formatCurrency(item.paidAmount) : "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-red-700">
        {item.balance > 0 ? formatCurrency(item.balance) : "—"}
      </td>
      <td className="px-3 py-3">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            DESPESA_STATUS_COLORS[item.status] ?? "bg-gray-100 text-gray-700"
          )}
        >
          {item.statusLabel}
        </span>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Drawer genérico (shell deslizante)
// ---------------------------------------------------------------------------

function DrawerShell({
  title,
  icon,
  onClose,
  children,
}: {
  title: string
  icon: React.ReactNode
  onClose: () => void
  children: React.ReactNode
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
            {icon}
            {title}
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
        {children}
      </aside>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-0.5">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="text-right text-gray-900">{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawer de detalhe (abas: resumo, pagamentos, histórico)
// ---------------------------------------------------------------------------

function DespesaDrawer({
  despesa,
  loading,
  onClose,
  onChanged,
}: {
  despesa: DespesaDetail | null
  loading: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [tab, setTab] = useState<"resumo" | "pagamentos" | "historico">("resumo")

  return (
    <DrawerShell
      title="Detalhe da despesa"
      icon={<ArrowDownCircle className="h-4 w-4 text-red-600" />}
      onClose={onClose}
    >
      {loading || !despesa ? (
        <div className="flex flex-1 items-center justify-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="flex gap-1 border-b border-gray-100 px-5 pt-3">
            {(
              [
                ["resumo", "Resumo"],
                ["pagamentos", `Pagamentos (${despesa.payments.length})`],
                ["historico", `Histórico (${despesa.logs.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-t-md px-3 py-2 text-xs font-medium transition-colors",
                  tab === key
                    ? "border-b-2 border-red-600 text-red-700"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-5 px-5 py-5">
            {tab === "resumo" ? <DespesaResumo despesa={despesa} /> : null}
            {tab === "pagamentos" ? <DespesaPagamentos despesa={despesa} /> : null}
            {tab === "historico" ? <DespesaHistorico despesa={despesa} /> : null}
          </div>

          <DespesaAcoes despesa={despesa} onClose={onClose} onChanged={onChanged} />
        </div>
      )}
    </DrawerShell>
  )
}

function DespesaResumo({ despesa }: { despesa: DespesaDetail }) {
  return (
    <>
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Descrição</p>
        <p className="mt-1 text-lg font-semibold text-gray-900">{despesa.description}</p>
        <p className="text-sm text-gray-500">{despesa.supplier ?? "Sem fornecedor"}</p>
      </section>

      <section className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Valor</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-gray-900">
            {formatCurrency(despesa.amount)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Pago</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-green-700">
            {formatCurrency(despesa.paidAmount)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Saldo</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-red-700">
            {formatCurrency(despesa.balance)}
          </p>
        </div>
      </section>

      <section className="space-y-2 text-sm">
        <Row label="Status">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
              DESPESA_STATUS_COLORS[despesa.status] ?? "bg-gray-100 text-gray-700"
            )}
          >
            {despesa.statusLabel}
          </span>
        </Row>
        <Row label="Categoria">{despesa.categoryName}</Row>
        <Row label="Competência">{formatDateOnly(despesa.competenceDate)}</Row>
        <Row label="Vencimento">
          {despesa.dueDate ? formatDateOnly(despesa.dueDate) : "—"}
        </Row>
        <Row label="Forma de pagamento">{despesa.paymentMethodLabel}</Row>
        {despesa.documentNumber ? (
          <Row label="Documento">{despesa.documentNumber}</Row>
        ) : null}
        {despesa.isRecurring ? <Row label="Recorrência">Recorrente</Row> : null}
        {despesa.notes ? <Row label="Observações">{despesa.notes}</Row> : null}
        <Row label="Criado por">{despesa.createdByName ?? "—"}</Row>
        <Row label="Registrado em">{formatDateTime(despesa.createdAt)}</Row>
        {despesa.cancelledAt ? (
          <>
            <Row label="Cancelado em">{formatDateTime(despesa.cancelledAt)}</Row>
            <Row label="Cancelado por">{despesa.cancelledByName ?? "—"}</Row>
            {despesa.cancelReason ? (
              <Row label="Motivo do cancelamento">{despesa.cancelReason}</Row>
            ) : null}
          </>
        ) : null}
      </section>
    </>
  )
}

function DespesaPagamentos({ despesa }: { despesa: DespesaDetail }) {
  if (despesa.payments.length === 0) {
    return (
      <EmptyState
        title="Nenhum pagamento registrado"
        description="Os pagamentos desta despesa aparecem aqui, do mais recente para o mais antigo."
      />
    )
  }
  return (
    <ul className="space-y-3">
      {despesa.payments.map((p) => (
        <li key={p.id} className="rounded-lg border border-gray-100 p-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold tabular-nums text-green-700">
              {formatCurrency(p.amount)}
            </span>
            <span className="text-xs text-gray-500">{p.paymentMethodLabel}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
            <span>{formatDateTime(p.paidAt)}</span>
            <span>{p.paidByName ?? "—"}</span>
          </div>
          {p.notes ? <p className="mt-1 text-xs text-gray-500">{p.notes}</p> : null}
        </li>
      ))}
    </ul>
  )
}

function DespesaHistorico({ despesa }: { despesa: DespesaDetail }) {
  if (despesa.logs.length === 0) {
    return (
      <EmptyState
        title="Sem histórico"
        description="As alterações da despesa ficam registradas aqui para auditoria."
      />
    )
  }
  return (
    <ol className="space-y-3">
      {despesa.logs.map((l) => (
        <li key={l.id} className="border-l-2 border-gray-100 pl-3">
          <p className="text-sm text-gray-800">{l.description}</p>
          <p className="text-xs text-gray-500">
            {l.event} · {formatDateTime(l.createdAt)}
            {l.performedByName ? ` · ${l.performedByName}` : ""}
          </p>
          {l.oldValue || l.newValue ? (
            <p className="text-xs text-gray-400">
              {l.oldValue ? `de ${l.oldValue}` : ""}
              {l.newValue ? ` para ${l.newValue}` : ""}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// Ações do drawer (pagar / editar / cancelar)
// ---------------------------------------------------------------------------

function DespesaAcoes({
  despesa,
  onClose,
  onChanged,
}: {
  despesa: DespesaDetail
  onClose: () => void
  onChanged: () => void
}) {
  const [mode, setMode] = useState<"none" | "pay" | "edit" | "cancel">("none")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCancelled = despesa.status === "CANCELADA"
  const isPaid = despesa.balance <= 0

  const call = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/financial/despesas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: despesa.id, ...body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "Não foi possível concluir a ação.")
      onChanged()
      setMode("none")
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao executar a ação.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <footer className="sticky bottom-0 space-y-3 border-t border-gray-100 bg-white px-5 py-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      {mode === "none" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={isCancelled || isPaid}
            title={
              isCancelled
                ? "Despesa cancelada"
                : isPaid
                  ? "Despesa já quitada"
                  : undefined
            }
            onClick={() => setMode("pay")}
          >
            Registrar pagamento
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isCancelled}
            onClick={() => setMode("edit")}
          >
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-700"
            disabled={isCancelled}
            onClick={() => setMode("cancel")}
          >
            Cancelar despesa
          </Button>
        </div>
      ) : null}

      {mode === "pay" ? (
        <PayForm
          remaining={despesa.balance}
          busy={busy}
          onCancel={() => setMode("none")}
          onSubmit={(payload) => void call({ action: "pay", ...payload })}
        />
      ) : null}

      {mode === "edit" ? (
        <EditForm
          despesa={despesa}
          busy={busy}
          onCancel={() => setMode("none")}
          onSubmit={(payload) => void call({ action: "update", ...payload })}
        />
      ) : null}

      {mode === "cancel" ? (
        <CancelForm
          busy={busy}
          onCancel={() => setMode("none")}
          onSubmit={(reason) => void call({ action: "cancel", reason })}
        />
      ) : null}
    </footer>
  )
}

// ---------------------------------------------------------------------------
// Formulários de ação
// ---------------------------------------------------------------------------

function PayForm({
  remaining,
  busy,
  onCancel,
  onSubmit,
}: {
  remaining: number
  busy: boolean
  onCancel: () => void
  onSubmit: (payload: { amount: number; paymentMethod: string; paidAt?: string; notes?: string }) => void
}) {
  const [amount, setAmount] = useState(remaining.toFixed(2))
  const [paymentMethod, setPaymentMethod] = useState("pix")
  const [paidAt, setPaidAt] = useState("")
  const [notes, setNotes] = useState("")

  const parsedAmount = Number(amount.replace(",", "."))
  const invalid = !Number.isFinite(parsedAmount) || parsedAmount <= 0

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Registrar pagamento
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-gray-500">Valor</Label>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Saldo em aberto: {formatCurrency(remaining)}
          </p>
        </div>
        <div>
          <Label className="text-xs text-gray-500">Forma</Label>
          <select
            className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            {DESPESA_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m] ?? m}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Label className="text-xs text-gray-500">Data do pagamento (opcional)</Label>
        <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </div>
      <div>
        <Label className="text-xs text-gray-500">Observação (opcional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || invalid}
          onClick={() =>
            onSubmit({
              amount: parsedAmount,
              paymentMethod,
              paidAt: paidAt || undefined,
              notes: notes.trim() || undefined,
            })
          }
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Confirmar pagamento
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Voltar
        </Button>
      </div>
    </div>
  )
}

function EditForm({
  despesa,
  busy,
  onCancel,
  onSubmit,
}: {
  despesa: DespesaDetail
  busy: boolean
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const [description, setDescription] = useState(despesa.description)
  const [supplier, setSupplier] = useState(despesa.supplier ?? "")
  const [amount, setAmount] = useState(despesa.amount.toFixed(2))
  const [competenceDate, setCompetenceDate] = useState(
    despesa.competenceDate.slice(0, 10)
  )
  const [dueDate, setDueDate] = useState(despesa.dueDate ? despesa.dueDate.slice(0, 10) : "")
  const [notes, setNotes] = useState(despesa.notes ?? "")
  const [documentNumber, setDocumentNumber] = useState(despesa.documentNumber ?? "")

  const parsedAmount = Number(amount.replace(",", "."))
  const invalid = description.trim().length < 2 || !Number.isFinite(parsedAmount) || parsedAmount <= 0

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Editar despesa
      </p>
      <div>
        <Label className="text-xs text-gray-500">Descrição</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-gray-500">Fornecedor</Label>
          <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs text-gray-500">Valor</Label>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-gray-500">Competência</Label>
          <Input
            type="date"
            value={competenceDate}
            onChange={(e) => setCompetenceDate(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs text-gray-500">Vencimento</Label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <div>
        <Label className="text-xs text-gray-500">Documento</Label>
        <Input
          value={documentNumber}
          onChange={(e) => setDocumentNumber(e.target.value)}
        />
      </div>
      <div>
        <Label className="text-xs text-gray-500">Observações</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || invalid}
          onClick={() =>
            onSubmit({
              description: description.trim(),
              supplier: supplier.trim() || null,
              amount: parsedAmount,
              competenceDate,
              dueDate: dueDate || null,
              documentNumber: documentNumber.trim() || null,
              notes: notes.trim() || null,
            })
          }
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Salvar alterações
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Voltar
        </Button>
      </div>
    </div>
  )
}

function CancelForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (reason: string | null) => void
}) {
  const [reason, setReason] = useState("")

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Cancelar despesa
      </p>
      <p className="text-xs text-gray-500">
        A despesa não é excluída: fica registrada como cancelada e sai dos totais em aberto.
      </p>
      <div>
        <Label className="text-xs text-gray-500">Motivo (opcional)</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-red-700"
          disabled={busy}
          onClick={() => onSubmit(reason.trim() || null)}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Confirmar cancelamento
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Voltar
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawer de criação
// ---------------------------------------------------------------------------

interface ExpenseCategoryOption {
  id: string
  name: string
  kind: string
  system: boolean
  active: boolean
}

function DespesaCreateDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [categories, setCategories] = useState<ExpenseCategoryOption[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)

  const [categoryId, setCategoryId] = useState("")
  const [description, setDescription] = useState("")
  const [supplier, setSupplier] = useState("")
  const [amount, setAmount] = useState("")
  const [competenceDate, setCompetenceDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [dueDate, setDueDate] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("")
  const [documentNumber, setDocumentNumber] = useState("")
  const [notes, setNotes] = useState("")
  const [isRecurring, setIsRecurring] = useState(false)
  const [markAsPaid, setMarkAsPaid] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/financial/expense-categories", {
          cache: "no-store",
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error ?? "Não foi possível carregar as categorias.")
        if (cancelled) return
        const list = (json.categories ?? []) as ExpenseCategoryOption[]
        setCategories(list)
        if (list.length > 0) setCategoryId(list[0].id)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao carregar categorias.")
        }
      } finally {
        if (!cancelled) setCategoriesLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const parsedAmount = Number(amount.replace(",", "."))
  const invalid =
    !categoryId ||
    description.trim().length < 2 ||
    !Number.isFinite(parsedAmount) ||
    parsedAmount <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(competenceDate)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/financial/despesas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          description: description.trim(),
          supplier: supplier.trim() || null,
          amount: parsedAmount,
          competenceDate,
          dueDate: dueDate || null,
          paymentMethod: paymentMethod || null,
          documentNumber: documentNumber.trim() || null,
          notes: notes.trim() || null,
          isRecurring,
          markAsPaid,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "Não foi possível criar a despesa.")
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar a despesa.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <DrawerShell
      title="Nova despesa"
      icon={<Plus className="h-4 w-4 text-red-600" />}
      onClose={onClose}
    >
      <div className="flex-1 space-y-4 px-5 py-5">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div>
          <Label className="text-xs text-gray-500">Categoria *</Label>
          <select
            className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
            value={categoryId}
            disabled={categoriesLoading}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {categoriesLoading ? <option value="">Carregando...</option> : null}
            {!categoriesLoading && categories.length === 0 ? (
              <option value="">Nenhuma categoria disponível</option>
            ) : null}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label className="text-xs text-gray-500">Descrição *</Label>
          <Input
            value={description}
            placeholder="Ex.: Compra de resina composta"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-gray-500">Fornecedor</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-gray-500">Valor *</Label>
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-gray-500">Competência *</Label>
            <Input
              type="date"
              value={competenceDate}
              onChange={(e) => setCompetenceDate(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-500">Vencimento</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-gray-500">Forma de pagamento</Label>
            <select
              className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="">Não informada</option>
              {DESPESA_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs text-gray-500">Documento</Label>
            <Input
              value={documentNumber}
              placeholder="Nota fiscal, boleto..."
              onChange={(e) => setDocumentNumber(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label className="text-xs text-gray-500">Observações</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="space-y-2 rounded-lg bg-gray-50 p-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
            />
            Despesa recorrente
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={markAsPaid}
              onChange={(e) => setMarkAsPaid(e.target.checked)}
            />
            Já foi paga (registrar pagamento total agora)
          </label>
        </div>
      </div>

      <footer className="sticky bottom-0 flex gap-2 border-t border-gray-100 bg-white px-5 py-4">
        <Button size="sm" disabled={busy || invalid} onClick={() => void submit()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Criar despesa
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
      </footer>
    </DrawerShell>
  )
}




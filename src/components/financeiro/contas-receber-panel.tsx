"use client"

// ===========================================================================
// CONTAS A RECEBER — painel do Financeiro.
// ===========================================================================
// Camada de APRESENTAÇÃO. Todo cálculo (saldo, vencimento, status derivado,
// dias até o vencimento) vem pronto do servidor. Esta tela:
//
//  - filtra, busca, ordena e pagina NO SERVIDOR (nunca baixa a base inteira);
//  - mostra o SALDO EM ABERTO como protagonista — nunca soma previsto ao
//    recebido, e nunca apresenta saldo como receita;
//  - trata o vencimento por DIA: uma conta que vence hoje NÃO está vencida;
//  - não afirma identidade: "Responsável" é atribuição textual, não login.

import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  Wallet,
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
  ContaReceberItem,
  ListContasReceberResult,
} from "@/lib/financial-contas-receber-service"

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

// Os valores são os do servidor (ACCOUNT_STATUSES) — nunca inventamos status.
const STATUS_OPTIONS = [
  { value: "EM_ABERTO", label: "Em aberto" },
  { value: "PARCIAL", label: "Parcial" },
  { value: "VENCIDO", label: "Vencido" },
  { value: "QUITADO", label: "Quitado" },
  { value: "CANCELADO", label: "Cancelado" },
]

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const STATUS_BADGE: Record<string, string> = {
  EM_ABERTO: "bg-amber-100 text-amber-800",
  PARCIAL: "bg-blue-100 text-blue-800",
  VENCIDO: "bg-red-100 text-red-800",
  QUITADO: "bg-green-100 text-green-800",
  CANCELADO: "bg-gray-100 text-gray-600",
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export function ContasReceberPanel() {
  const [period, setPeriod] = useState("month")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [status, setStatus] = useState("")
  const [professionalName, setProfessionalName] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<"dueDate" | "balance" | "patient" | "expected">(
    "dueDate"
  )
  const [direction, setDirection] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

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

  // A busca é feita pelo `useAsyncData`: o hook mantém todo `setState` depois do
  // primeiro `await`, então o efeito não dispara renderização em cascata e
  // respostas fora de ordem são descartadas.
  const load = useCallback(async () => {
    const params = new URLSearchParams()
    params.set("period", period)
    if (period === "custom") {
      if (from) params.set("from", from)
      if (to) params.set("to", to)
    }
    if (status) params.set("status", status)
    if (professionalName.trim()) params.set("professionalName", professionalName.trim())
    if (search) params.set("search", search)
    params.set("sort", sort)
    params.set("direction", direction)
    params.set("page", String(page))
    params.set("pageSize", String(pageSize))

    const res = await fetch(`/api/financial/contas-receber?${params.toString()}`, {
      cache: "no-store",
    })
    const json = await res.json()
    if (!res.ok) {
      throw new Error(json?.error ?? "Não foi possível carregar as contas a receber.")
    }
    return json as ListContasReceberResult
  }, [period, from, to, status, professionalName, search, sort, direction, page, pageSize])

  const { data, error, isLoading, reload } = useAsyncData<ListContasReceberResult>(
    load,
    [load]
  )

  const loading = isLoading
  const errorMessage = error || null

  const clearFilters = () => {
    setStatus("")
    setProfessionalName("")
    setSearchInput("")
    setSearch("")
    setPage(1)
  }

  const toggleSort = (field: "dueDate" | "balance" | "patient" | "expected") => {
    if (sort === field) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSort(field)
      // Saldo e previsto fazem mais sentido do maior para o menor; data e
      // paciente, do menor para o maior.
      setDirection(field === "patient" || field === "dueDate" ? "asc" : "desc")
    }
    setPage(1)
  }

  const summary = data?.summary
  const pagination = data?.pagination
  const hasActiveFilters = Boolean(status || professionalName || search)

  return (
    <div className="space-y-6">
      {/* Cabeçalho ------------------------------------------------------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Wallet className="h-6 w-6 text-amber-600" />
            Contas a Receber
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Quanto ainda falta receber, por atendimento. O saldo em aberto nunca é
            somado ao que já entrou.
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
          label="Saldo em aberto"
          value={summary?.totalBalance ?? 0}
          tone="warning"
          hint={
            summary
              ? `${summary.openCount + summary.partialCount + summary.overdueCount} conta(s) — não é receita`
              : "Não é receita recebida"
          }
          icon={<Wallet className="h-5 w-5" />}
        />
        <MetricCard
          label="Vencido"
          value={summary?.overdueBalance ?? 0}
          tone="negative"
          hint={
            summary ? `${summary.overdueCount} conta(s) fora do prazo` : "Fora do prazo"
          }
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <MetricCard
          label="Vence hoje"
          value={summary?.dueTodayBalance ?? 0}
          tone="neutral"
          hint={
            summary
              ? `${summary.dueTodayCount} conta(s) — ainda no prazo`
              : "Hoje ainda está no prazo"
          }
          icon={<CalendarClock className="h-5 w-5" />}
        />
        <MetricCard
          label="A receber (futuro)"
          value={summary?.upcomingBalance ?? 0}
          hint={summary ? `${summary.partialCount} parcial(is)` : undefined}
        />
      </div>

      {/* Filtros --------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarClock className="h-4 w-4 text-gray-400" />
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
                    ? "bg-amber-600 text-white"
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
                  ? "bg-amber-600 text-white"
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          </div>

          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-2 h-4 w-4" />
              Limpar filtros
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Tabela ---------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">
            Contas em aberto
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
          {errorMessage ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : null}

          {loading && !data ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : data && data.contas.length === 0 ? (
            <EmptyState
              title="Nenhuma conta a receber encontrada"
              description={
                hasActiveFilters
                  ? "Ajuste os filtros ou limpe a busca para ver mais resultados."
                  : "Assim que houver cobranças com saldo em aberto, elas aparecem aqui."
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
                        onClick={() => toggleSort("dueDate")}
                      >
                        Vencimento
                        {sort === "dueDate" ? (direction === "asc" ? " ▲" : " ▼") : null}
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
                    <th className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        onClick={() => toggleSort("expected")}
                      >
                        Previsto
                        {sort === "expected" ? (direction === "asc" ? " ▲" : " ▼") : null}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right">Recebido</th>
                    <th className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-gray-700"
                        onClick={() => toggleSort("balance")}
                      >
                        Saldo
                        {sort === "balance" ? (direction === "asc" ? " ▲" : " ▼") : null}
                      </button>
                    </th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.contas.map((item) => (
                    <ContaRow key={item.id} item={item} />
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

      {/* Nota de contexto ------------------------------------------------ */}
      <p className="text-xs text-gray-400">
        Valores previstos e recebidos aparecem apenas como contexto. Receitas
        detalhadas ficam em /financeiro/receitas.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha da tabela
// ---------------------------------------------------------------------------

function ContaRow({ item }: { item: ContaReceberItem }) {
  const proceduresText =
    item.procedures.length > 0 ? item.procedures.map((p) => p.name).join(", ") : "—"

  // O atraso é uma leitura do servidor (`daysUntilDue`), não um cálculo local.
  const dueHint =
    item.status === "VENCIDO"
      ? `${Math.abs(item.daysUntilDue)} dia(s) em atraso`
      : item.daysUntilDue === 0
        ? "vence hoje"
        : `em ${item.daysUntilDue} dia(s)`

  return (
    <tr className="border-b border-gray-50 transition-colors hover:bg-gray-50">
      <td className="whitespace-nowrap px-3 py-3">
        <p className={cn("text-gray-900", item.status === "VENCIDO" && "text-red-700")}>
          {item.dueDate ? item.dueDate.slice(0, 10).split("-").reverse().join("/") : "—"}
        </p>
        <p
          className={cn(
            "text-[11px]",
            item.status === "VENCIDO" ? "text-red-600" : "text-gray-400"
          )}
        >
          {item.status === "QUITADO" || item.status === "CANCELADO" ? "" : dueHint}
        </p>
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
        <p className="text-[11px] text-gray-400">
          {item.appointmentDate ? item.appointmentDate.slice(0, 10) : ""}
          {item.appointmentTime ? ` ${item.appointmentTime}` : ""}
        </p>
      </td>
      <td className="max-w-[220px] px-3 py-3">
        <p className="truncate text-gray-700" title={proceduresText}>
          {proceduresText}
        </p>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-gray-500">
        {formatCurrency(item.expectedAmount)}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-gray-600">
        {item.receivedAmount > 0 ? formatCurrency(item.receivedAmount) : "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
        <span className={item.balance > 0 ? "text-amber-700" : "text-gray-400"}>
          {formatCurrency(item.balance)}
        </span>
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
        {item.lastPayment ? (
          <p className="mt-1 text-[11px] text-gray-400">
            último {formatCurrency(item.lastPayment.amount)}
            {item.lastPayment.paidAt
              ? ` · ${formatDateTime(item.lastPayment.paidAt)}`
              : ""}
          </p>
        ) : null}
      </td>
    </tr>
  )
}

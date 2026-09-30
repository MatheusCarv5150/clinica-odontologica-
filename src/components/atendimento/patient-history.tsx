"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertTriangle,
  CalendarRange,
  ChevronDown,
  Clock,
  FileText,
  History,
  Loader2,
  Stethoscope,
  UserRound,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAsyncData } from "@/lib/use-async-data"
import {
  type PatientHistoryItem,
  type PatientHistoryResponse,
  formatHistoryDate,
  formatHistoryDateTime,
  formatHistoryLongDate,
  getHistoryStatusMeta,
  summarizeProcedures,
  truncateText,
} from "@/lib/patient-history"

// ---------------------------------------------------------------------------
// Contrato com a API de histórico (Parte 3)
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 5

interface PatientHistoryProps {
  // Id do atendimento ATUAL. O backend resolve o paciente a partir dele —
  // o histórico nunca recebe o pacienteId do cliente (isolamento garantido).
  attendanceId: string
  // Recarrega o histórico quando o atendimento muda de status.
  refreshKey?: number
}

type StatusFilter = "all" | "completed" | "cancelled" | "no_show"

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "completed", label: "Concluídos" },
  { value: "cancelled", label: "Cancelados" },
  { value: "no_show", label: "Não compareceu" },
]

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function PatientHistory({ attendanceId, refreshKey = 0 }: PatientHistoryProps) {
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [showFilters, setShowFilters] = useState(false)

  const [detailsId, setDetailsId] = useState<string | null>(null)

  const buildParams = useCallback(
    (targetPage: number) => {
      const params = new URLSearchParams()
      params.set("page", String(targetPage))
      params.set("pageSize", String(DEFAULT_PAGE_SIZE))
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (fromDate) params.set("from", fromDate)
      if (toDate) params.set("to", toDate)
      return params
    },
    [statusFilter, fromDate, toDate]
  )

  // Carregamento inicial / recarga por filtro (via hook, sem efeito manual).
  const loadFirstPage = useCallback(
    async () => {
      const res = await fetch(
        `/api/attendance/${attendanceId}/history?${buildParams(1).toString()}`,
        { cache: "no-store" }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(
          err.error || "Não foi possível carregar o histórico do paciente."
        )
      }
      return (await res.json()) as PatientHistoryResponse
    },
    [attendanceId, buildParams]
  )

  const {
    data,
    isLoading,
    error: loadError,
    reload: reloadHistory,
  } = useAsyncData<PatientHistoryResponse>(loadFirstPage, [
    attendanceId,
    buildParams,
    refreshKey,
  ])

  const error = loadError
    ? "Não foi possível carregar o histórico do paciente."
    : ""

  // A primeira página vem da resposta; as páginas seguintes ficam em estado
  // local. A página atual derivada evita re-sincronizar `page` por efeito.
  const [extraItems, setExtraItems] = useState<PatientHistoryItem[]>([])
  const [extraPages, setExtraPages] = useState(0)
  const [hasMoreExtra, setHasMoreExtra] = useState<boolean | null>(null)

  const items = useMemo(
    () => [...(data?.items ?? []), ...extraItems],
    [data?.items, extraItems]
  )
  const page = 1 + extraPages
  const hasMore = hasMoreExtra ?? data?.pagination.hasMore ?? false

  // Carregamento progressivo ("Carregar mais").
  async function loadMore() {
    if (isLoadingMore || !hasMore) return
    const nextPage = page + 1
    setIsLoadingMore(true)
    try {
      const res = await fetch(
        `/api/attendance/${attendanceId}/history?${buildParams(nextPage).toString()}`,
        { cache: "no-store" }
      )
      if (res.ok) {
        const payload = (await res.json()) as PatientHistoryResponse
        setExtraItems((prev) => [...prev, ...payload.items])
        setExtraPages((prev) => prev + 1)
        setHasMoreExtra(payload.pagination.hasMore)
      }
    } catch {
      // Falha ao paginar não apaga o que já foi carregado.
    } finally {
      setIsLoadingMore(false)
    }
  }

  const hasActiveFilters =
    statusFilter !== "all" || fromDate !== "" || toDate !== ""

  function clearFilters() {
    setStatusFilter("all")
    setFromDate("")
    setToDate("")
  }

  const summary = data?.summary
  const current = data?.current ?? null

  const summaryLine = useMemo(() => {
    if (!summary) return null
    const parts: string[] = []
    parts.push(
      summary.total === 1 ? "1 atendimento" : `${summary.total} atendimentos`
    )
    if (summary.completed > 0) parts.push(`${summary.completed} concluído${summary.completed === 1 ? "" : "s"}`)
    if (summary.lastVisit) {
      parts.push(`último em ${formatHistoryDate(summary.lastVisit)}`)
    }
    return parts.join(" • ")
  }, [summary])

  return (
    <section
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      aria-label="Histórico do paciente"
    >
      {/* Cabeçalho da seção */}
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <History className="h-4 w-4 text-blue-600" />
            Histórico do paciente
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {summaryLine ?? "Atendimentos anteriores deste paciente"}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 self-start rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
            showFilters || hasActiveFilters
              ? "border-blue-300 bg-blue-50 text-blue-700"
              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          )}
          aria-expanded={showFilters}
        >
          <CalendarRange className="h-3.5 w-3.5" />
          Filtros
          {hasActiveFilters && (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
          )}
        </button>
      </div>

      {/* Filtros (secundários — prioridade é a visualização rápida) */}
      {showFilters && (
        <div className="border-b border-gray-100 bg-gray-50 px-5 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Status
              </label>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setStatusFilter(f.value)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                      statusFilter === f.value
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="history-from"
                  className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400"
                >
                  De
                </label>
                <input
                  id="history-from"
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label
                  htmlFor="history-to"
                  className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400"
                >
                  Até
                </label>
                <input
                  id="history-to"
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" />
                  Limpar
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="p-5">
        {/* Atendimento atual — bloco destacado com editor de evolução */}
        {current && (
          <CurrentAttendanceCard
            item={current}
            attendanceId={attendanceId}
            onUpdated={loadFirstPage}
          />
        )}

        <div className="mt-5">
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {current ? "Histórico anterior" : "Atendimentos"}
          </h3>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando histórico...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 py-8 text-center">
              <AlertTriangle className="h-6 w-6 text-red-400" />
              <p className="text-sm text-red-700">{error}</p>
              <Button variant="outline" size="sm" onClick={reloadHistory}>
                Tentar novamente
              </Button>
            </div>
          ) : items.length === 0 ? (
            <EmptyHistory hasFilters={hasActiveFilters} onClearFilters={clearFilters} />
          ) : (
            <>
              <ol className="relative space-y-2.5">
                {items.map((item, index) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    isLast={index === items.length - 1 && !hasMore}
                    onOpenDetails={setDetailsId}
                  />
                ))}
              </ol>

              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadMore}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Carregando...
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        Carregar mais atendimentos
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {detailsId && (
        <HistoryDetailsModal
          attendanceId={attendanceId}
          recordId={detailsId}
          onClose={() => setDetailsId(null)}
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Atendimento atual com editor de Evolução / Observação
// ---------------------------------------------------------------------------

function CurrentAttendanceCard({
  item,
  attendanceId,
  onUpdated,
}: {
  item: PatientHistoryItem
  attendanceId: string
  onUpdated: () => void
}) {
  const meta = getHistoryStatusMeta(item.status)
  const [evolution, setEvolution] = useState(item.evolution || "")
  const [notes, setNotes] = useState(item.notes || "")
  const [isSaving, setIsSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [error, setError] = useState("")

  // Sincroniza se o item externo mudar. Ajuste de estado durante a renderização
  // (padrão recomendado pelo React) em vez de efeito: evita um render extra com
  // o valor antigo e mantém o campo editável alinhado ao dado do servidor.
  const [lastSynced, setLastSynced] = useState({
    evolution: item.evolution,
    notes: item.notes,
  })
  if (
    lastSynced.evolution !== item.evolution ||
    lastSynced.notes !== item.notes
  ) {
    setLastSynced({ evolution: item.evolution, notes: item.notes })
    setEvolution(item.evolution || "")
    setNotes(item.notes || "")
  }

  async function handleSave() {
    setIsSaving(true)
    setError("")
    setSavedSuccess(false)
    try {
      const res = await fetch(`/api/attendance/${attendanceId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evolution, notes }),
      })
      if (res.ok) {
        setSavedSuccess(true)
        onUpdated()
        setTimeout(() => setSavedSuccess(false), 3000)
      } else {
        const err = await res.json().catch(() => ({}))
        setError(err.error || "Erro ao salvar evolução.")
      }
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-blue-200 border-l-4 border-l-blue-500 bg-blue-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-blue-600 text-white">ATENDIMENTO ATUAL</Badge>
          <span className="text-sm font-semibold text-gray-900">
            {formatHistoryDateTime(item.date, item.time)}
          </span>
        </div>
        <Badge className={cn("gap-1.5", meta.badge)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </Badge>
      </div>

      <div className="mt-2.5">
        <ProcedureList procedures={item.procedures} emptyLabel="Nenhum procedimento previsto" />
      </div>

      {/* Seção interativa para inserir / editar Evolução e Observação do atendimento atual */}
      <div className="mt-4 border-t border-blue-200/60 pt-3 space-y-3">
        <div>
          <label
            htmlFor="current-evolution"
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-blue-900"
          >
            Evolução clínica do atendimento atual
          </label>
          <textarea
            id="current-evolution"
            rows={3}
            value={evolution}
            onChange={(e) => setEvolution(e.target.value)}
            placeholder="Digite a evolução clínica, intercorrências ou conduta realizada neste atendimento..."
            className="w-full rounded-lg border border-blue-200 bg-white p-2.5 text-xs text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="current-notes"
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600"
          >
            Observação do atendimento (opcional)
          </label>
          <input
            id="current-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações pontuais sobre o atendimento..."
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          {error ? (
            <p className="text-xs text-red-600 font-medium">{error}</p>
          ) : savedSuccess ? (
            <p className="text-xs text-green-700 font-medium">Evolução salva com sucesso!</p>
          ) : (
            <p className="text-[11px] text-gray-500">As alterações ficam registradas no histórico deste atendimento.</p>
          )}

          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-4"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar evolução"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha do histórico
// ---------------------------------------------------------------------------

function HistoryRow({
  item,
  isLast,
  onOpenDetails,
}: {
  item: PatientHistoryItem
  isLast: boolean
  onOpenDetails: (id: string) => void
}) {
  const meta = getHistoryStatusMeta(item.status)
  const isCancelled = item.status === "cancelled"
  const isNoShow = item.status === "no_show"
  const notesSummary = item.notes ? truncateText(item.notes, 160) : null
  const evolutionSummary = item.evolution ? truncateText(item.evolution, 160) : null

  return (
    <li className="relative flex gap-3">
      {/* Linha do tempo */}
      <div className="flex flex-col items-center pt-1.5">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", meta.dot)} />
        {!isLast && <span className="mt-1 w-px flex-1 bg-gray-200" />}
      </div>

      <div
        className={cn(
          "mb-1 min-w-0 flex-1 rounded-lg border border-gray-200 p-3.5 transition-colors hover:bg-gray-50",
          isCancelled && "border-red-200 bg-red-50/40",
          isNoShow && "border-orange-200 bg-orange-50/40"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {formatHistoryDateTime(item.date, item.time)}
            </span>
            <Badge className={cn("gap-1.5 text-[11px]", meta.badge)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </Badge>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenDetails(item.id)}
            className="shrink-0 text-blue-700"
          >
            Ver detalhes
          </Button>
        </div>

        <div className="mt-2">
          <ProcedureList
            procedures={item.procedures}
            emptyLabel={
              isCancelled || isNoShow
                ? "Sem procedimentos realizados"
                : "Nenhum procedimento registrado"
            }
          />
        </div>

        {item.professional && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-600">
            <UserRound className="h-3.5 w-3.5 text-gray-400" />
            Profissional: <span className="font-medium">{item.professional.name}</span>
          </p>
        )}

        {notesSummary && (
          <div className="mt-2 rounded-md bg-gray-50 px-2.5 py-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Observação
            </p>
            <p className="mt-0.5 text-xs text-gray-700">{notesSummary.text}</p>
            {notesSummary.truncated && (
              <button
                type="button"
                onClick={() => onOpenDetails(item.id)}
                className="mt-0.5 text-[11px] font-medium text-blue-700 hover:underline"
              >
                Ver mais
              </button>
            )}
          </div>
        )}

        {evolutionSummary && (
          <div className="mt-2 rounded-md bg-blue-50/60 px-2.5 py-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-blue-400">
              Evolução
            </p>
            <p className="mt-0.5 text-xs text-gray-700">{evolutionSummary.text}</p>
            <button
              type="button"
              onClick={() => onOpenDetails(item.id)}
              className="mt-0.5 text-[11px] font-medium text-blue-700 hover:underline"
            >
              Ver evolução completa
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Procedimentos (snapshot histórico)
// ---------------------------------------------------------------------------

function ProcedureList({
  procedures,
  emptyLabel,
}: {
  procedures: PatientHistoryItem["procedures"]
  emptyLabel: string
}) {
  if (procedures.length === 0) {
    return <p className="text-xs text-gray-400">{emptyLabel}</p>
  }

  const { text } = summarizeProcedures(procedures, 3)

  return (
    <div className="flex items-start gap-1.5">
      <Stethoscope className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
      <p className="text-xs text-gray-700">{text}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Estado vazio
// ---------------------------------------------------------------------------

function EmptyHistory({
  hasFilters,
  onClearFilters,
}: {
  hasFilters: boolean
  onClearFilters: () => void
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center">
      <History className="mx-auto h-8 w-8 text-gray-300" />
      <p className="mt-2 text-sm font-medium text-gray-600">
        {hasFilters
          ? "Nenhum atendimento encontrado com os filtros aplicados."
          : "Nenhum atendimento anterior registrado."}
      </p>
      <p className="mt-1 text-xs text-gray-400">
        {hasFilters
          ? "Ajuste ou limpe os filtros para ver mais registros."
          : "Este é o primeiro atendimento deste paciente no sistema."}
      </p>
      {hasFilters && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onClearFilters}>
          Limpar filtros
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detalhes de um atendimento anterior
// ---------------------------------------------------------------------------

interface HistoryRecordDetail {
  id: string
  date: string
  time: string | null
  status: string
  totalAmount: number | null
  createdAt: string
  procedures: Array<{
    id: string
    name: string
    unitPrice: number
    quantity: number
    totalPrice: number
  }>
  professional: { id: string; name: string } | null
  notes: string | null
  evolution: string | null
}

function HistoryDetailsModal({
  attendanceId,
  recordId,
  onClose,
}: {
  attendanceId: string
  recordId: string
  onClose: () => void
}) {
  const [record, setRecord] = useState<HistoryRecordDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError("")
      try {
        const res = await fetch(
          `/api/attendance/${attendanceId}/history/${recordId}`,
          { cache: "no-store" }
        )
        if (cancelled) return
        if (res.ok) {
          const payload = await res.json()
          setRecord(payload.record as HistoryRecordDetail)
        } else {
          const err = await res.json().catch(() => ({}))
          setError(err.error || "Não foi possível carregar os detalhes.")
        }
      } catch {
        if (!cancelled) setError("Erro de conexão. Tente novamente.")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [attendanceId, recordId])

  const meta = record ? getHistoryStatusMeta(record.status) : null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-16">
      <div className="relative mx-auto mb-10 w-full max-w-lg">
        <div className="rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <FileText className="h-5 w-5 text-blue-600" />
              Detalhes do atendimento
            </h2>
            <button
              type="button"
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              onClick={onClose}
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 p-5">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando detalhes...
              </div>
            ) : error || !record || !meta ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 py-6 text-center">
                <AlertTriangle className="h-6 w-6 text-red-400" />
                <p className="text-sm text-red-700">
                  {error || "Detalhes indisponíveis."}
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Clock className="h-4 w-4 text-gray-400" />
                    {formatHistoryLongDate(record.date)}
                    {record.time && <span className="text-gray-500">• {record.time}</span>}
                  </div>
                  <Badge className={cn("gap-1.5", meta.badge)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                    {meta.label}
                  </Badge>
                </div>

                {record.professional && (
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                      Profissional responsável
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-gray-900">
                      {record.professional.name}
                    </p>
                  </div>
                )}

                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    Procedimentos
                  </p>
                  {record.procedures.length === 0 ? (
                    <p className="text-xs text-gray-400">
                      Nenhum procedimento registrado.
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                      {record.procedures.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                        >
                          <span className="min-w-0 text-gray-800">
                            {p.name}
                            {p.quantity > 1 && (
                              <span className="text-gray-400"> ×{p.quantity}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {record.notes && (
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                      Observação do atendimento
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                      {record.notes}
                    </p>
                  </div>
                )}

                {record.evolution && (
                  <div className="rounded-lg bg-blue-50 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-blue-400">
                      Evolução clínica
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                      {record.evolution}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

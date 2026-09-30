"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  History,
  Loader2,
  Play,
  Stethoscope,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAsyncData } from "@/lib/use-async-data"
import {
  type TimelineEntry,
  type TimelineResponse,
  formatTimelineCardDate,
  formatTimelineTime,
  getTimelineKindMeta,
} from "@/lib/evolution-timeline"
import {
  EMPTY_FILTERS,
  TimelineFilters,
  type TimelineFilterState,
} from "./evolution-timeline-filters"
import { TimelineCard } from "./evolution-timeline-card"
import { AttendanceDetailModal } from "./attendance-detail-modal"

// ===========================================================================
// EVOLUÇÃO — LINHA DO TEMPO CLÍNICA DO PACIENTE (Parte 8).
//
// NÃO confundir com a Parte 6 (Registro do Atendimento). Aqui o objetivo é
// mostrar COMO A HISTÓRIA CLÍNICA DO PACIENTE SE DESENVOLVEU ao longo do
// tempo, conectando os atendimentos já registrados.
//
// Estrutura:
//   1. Atendimento ATUAL destacado no topo (quando existe).
//   2. Histórico clínico em linha do tempo (mais recente → mais antigo),
//      agrupado por dia, com resumo, procedimentos, dentes e intercorrências.
//   3. Filtros (período, profissional, procedimento, dente, busca, ordenação).
//   4. "Ver atendimento completo" em modo somente leitura.
// ===========================================================================

const PAGE_SIZE = 10

interface EvolutionTimelinePanelProps {
  attendanceId: string
  // Recarrega quando o atendimento atual muda (ex.: iniciado/finalizado).
  refreshKey?: number
  // Abre o atendimento atual na área de registro (Parte 6).
  onContinueAttendance?: () => void
}

export function EvolutionTimelinePanel({
  attendanceId,
  refreshKey = 0,
  onContinueAttendance,
}: EvolutionTimelinePanelProps) {
  const [filters, setFilters] = useState<TimelineFilterState>(EMPTY_FILTERS)
  const [detailRecordId, setDetailRecordId] = useState<string | null>(null)

  // Carregamento progressivo: a primeira página vem pela consulta principal;
  // as seguintes são acumuladas no estado local.
  const [extraItems, setExtraItems] = useState<TimelineEntry[]>([])
  const [extraPages, setExtraPages] = useState(0)
  const [hasMoreExtra, setHasMoreExtra] = useState<boolean | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const buildParams = useCallback(
    (targetPage: number) => {
      const params = new URLSearchParams()
      params.set("page", String(targetPage))
      params.set("pageSize", String(PAGE_SIZE))
      params.set("period", filters.period)
      params.set("sort", filters.sort)
      if (filters.from) params.set("from", filters.from)
      if (filters.to) params.set("to", filters.to)
      if (filters.professional) params.set("professional", filters.professional)
      if (filters.procedure) params.set("procedure", filters.procedure)
      if (filters.tooth) params.set("tooth", filters.tooth)
      if (filters.query) params.set("q", filters.query)
      if (filters.includeNonClinical) params.set("includeNonClinical", "1")
      return params
    },
    [filters]
  )

  const loadFirstPage = useCallback(async () => {
    const res = await fetch(
      `/api/attendance/${attendanceId}/evolution-timeline?${buildParams(1)}`,
      { cache: "no-store" }
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(
        err.error || "Não foi possível carregar a evolução clínica do paciente."
      )
    }
    return (await res.json()) as TimelineResponse
  }, [attendanceId, buildParams])

  const {
    data,
    isLoading,
    error: loadError,
    reload,
  } = useAsyncData<TimelineResponse>(loadFirstPage, [
    attendanceId,
    buildParams,
    refreshKey,
  ])

  // Ao mudar qualquer filtro, descarta as páginas extras acumuladas. Adia a
  // atualização via rAF para não chamar setState síncrono no corpo do efeito
  // (evita react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setExtraItems([])
      setExtraPages(0)
      setHasMoreExtra(null)
    })
    return () => cancelAnimationFrame(id)
  }, [buildParams])

  const items = useMemo(
    () => [...(data?.items ?? []), ...extraItems],
    [data?.items, extraItems]
  )
  const page = 1 + extraPages
  const hasMore = hasMoreExtra ?? data?.pagination.hasMore ?? false

  async function loadMore() {
    if (isLoadingMore || !hasMore) return
    const nextPage = page + 1
    setIsLoadingMore(true)
    try {
      const res = await fetch(
        `/api/attendance/${attendanceId}/evolution-timeline?${buildParams(nextPage)}`,
        { cache: "no-store" }
      )
      if (res.ok) {
        const payload = (await res.json()) as TimelineResponse
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

  // Reagrupa os itens acumulados por dia (o backend agrupa apenas a página).
  const groups = useMemo(() => {
    const result: Array<{ dateKey: string; label: string; entries: TimelineEntry[] }> = []
    for (const item of items) {
      const dateKey = item.date.split("T")[0]
      const last = result[result.length - 1]
      if (!last || last.dateKey !== dateKey) {
        result.push({
          dateKey,
          label: new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString("pt-BR", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }),
          entries: [item],
        })
      } else {
        last.entries.push(item)
      }
    }
    return result
  }, [items])

  const error = loadError ? loadError : ""

  return (
    <div className="space-y-5">
      {/* Cabeçalho da área */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <Activity className="h-5 w-5 text-blue-600" />
            Evolução
          </h2>
          <p className="text-sm text-gray-500">
            Linha do tempo clínica do paciente
          </p>
        </div>

        {/* Resumo clínico */}
        {data && (
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Atendimentos
              </dt>
              <dd className="font-semibold text-gray-900">
                {data.summary.totalAttendance}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Documentados
              </dt>
              <dd className="font-semibold text-gray-900">
                {data.summary.documented}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Dentes tratados
              </dt>
              <dd className="font-semibold text-gray-900">
                {data.summary.teethTreated}
              </dd>
            </div>
            {data.summary.lastClinicalVisit && (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  Última visita
                </dt>
                <dd className="font-semibold text-gray-900">
                  {formatTimelineCardDate(data.summary.lastClinicalVisit)}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-14 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando evolução clínica...
        </div>
      )}

      {error && !isLoading && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 py-12 text-center">
          <AlertTriangle className="h-10 w-10 text-red-300" />
          <p className="mt-2 text-sm font-medium text-red-800">{error}</p>
          <Button variant="outline" className="mt-4" onClick={reload}>
            Tentar novamente
          </Button>
        </div>
      )}

      {data && !isLoading && !error && (
        <>
          {/* ---------------------------------------------------------------- */}
          {/* ATENDIMENTO ATUAL — destacado e SEPARADO do histórico clínico.    */}
          {/* ---------------------------------------------------------------- */}
          {data.current && (
            <CurrentAttendanceCard
              entry={data.current}
              onOpenFull={() => setDetailRecordId(data.current!.id)}
              onContinue={onContinueAttendance}
            />
          )}

          {/* Filtros */}
          <TimelineFilters
            filters={data.filters}
            value={filters}
            onChange={setFilters}
          />

          {/* Histórico clínico */}
          <section>
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <History className="h-4 w-4 text-gray-400" />
              Histórico clínico
              {items.length > 0 && (
                <span className="text-xs font-normal text-gray-400">
                  ({data.pagination.total})
                </span>
              )}
            </h3>

            {items.length === 0 ? (
              <EmptyState
                includeNonClinical={filters.includeNonClinical}
                hasFilters={
                  filters.period !== "all" ||
                  !!filters.professional ||
                  !!filters.procedure ||
                  !!filters.tooth ||
                  !!filters.query
                }
              />
            ) : (
              <div className="space-y-6">
                {groups.map((group) => (
                  <div key={group.dateKey}>
                    {/* Agrupamento por data: rótulo do dia */}
                    <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      {group.label}
                    </p>
                    <ul className="space-y-0">
                      {group.entries.map((entry, index) => (
                        <TimelineCard
                          key={`${entry.id}-${index}`}
                          entry={entry}
                          isLast={index === group.entries.length - 1}
                          onOpenFull={(e) => setDetailRecordId(e.id)}
                          onFilterTooth={(tooth) =>
                            setFilters((prev) => ({ ...prev, tooth }))
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ))}

                {hasMore && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      onClick={loadMore}
                      disabled={isLoadingMore}
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Carregando...
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4" />
                          Carregar mais atendimentos
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {detailRecordId && (
        <AttendanceDetailModal
          attendanceId={attendanceId}
          recordId={detailRecordId}
          onClose={() => setDetailRecordId(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Atendimento atual — bloco destacado, visualmente separado da história.
// ---------------------------------------------------------------------------

function CurrentAttendanceCard({
  entry,
  onOpenFull,
  onContinue,
}: {
  entry: TimelineEntry
  onOpenFull: () => void
  onContinue?: () => void
}) {
  const meta = getTimelineKindMeta(entry.kind)
  const timeLabel = formatTimelineTime(entry.time)

  return (
    <section
      className="overflow-hidden rounded-xl border-2 border-blue-300 bg-blue-50/40 shadow-sm"
      aria-label="Atendimento atual"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-blue-100 bg-blue-50 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-800">
          <Play className="h-3.5 w-3.5" />
          Atendimento atual
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            meta.badge
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-blue-800">
          <CalendarClock className="h-3.5 w-3.5" />
          {formatTimelineCardDate(entry.date)}
          {timeLabel ? ` • ${timeLabel}` : ""}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-sm text-gray-700">
          {entry.professional ? (
            <>
              Profissional:{" "}
              <span className="font-medium">{entry.professional.name}</span>
            </>
          ) : (
            <span className="italic text-gray-400">
              Profissional ainda não informado
            </span>
          )}
        </p>

        {entry.chiefComplaint && (
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-700">Queixa: </span>
            {entry.chiefComplaint}
          </p>
        )}

        {entry.procedures.length > 0 && (
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              <Stethoscope className="h-3 w-3" />
              Procedimentos já registrados
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {entry.procedures.map((proc) => (
                <li
                  key={proc.id}
                  className="rounded-full border border-blue-200 bg-white px-2.5 py-0.5 text-xs text-blue-800"
                >
                  {proc.name}
                  {proc.toothNumber ? ` — ${proc.toothNumber}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onContinue && (
            <Button size="sm" onClick={onContinue}>
              <Play className="h-3.5 w-3.5" />
              Continuar atendimento
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onOpenFull}>
            <ClipboardList className="h-3.5 w-3.5" />
            Ver atendimento completo
          </Button>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  includeNonClinical,
  hasFilters,
}: {
  includeNonClinical: boolean
  hasFilters: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-14 text-center">
      <Activity className="h-12 w-12 text-gray-300" />
      <h3 className="mt-3 text-base font-medium text-gray-900">
        {hasFilters
          ? "Nenhum atendimento encontrado com os filtros aplicados"
          : "Ainda não há evolução clínica registrada"}
      </h3>
      <p className="mt-1 max-w-md text-sm text-gray-500">
        {hasFilters
          ? "Ajuste o período, o profissional, o procedimento, o dente ou a busca para ver outros registros."
          : "Conforme atendimentos forem concluídos e registrados, a trajetória clínica do paciente aparecerá aqui em ordem cronológica."}
      </p>
      {!includeNonClinical && !hasFilters && (
        <p className="mt-3 max-w-md text-xs text-gray-400">
          Cancelamentos e não comparecimentos não geram evolução clínica. Para
          vê-los, marque a opção de incluir registros não clínicos nos filtros.
        </p>
      )}
    </div>
  )
}

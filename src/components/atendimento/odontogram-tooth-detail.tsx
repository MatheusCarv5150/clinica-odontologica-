"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAsyncData } from "@/lib/use-async-data"
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  Plus,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  formatSurfaces,
  getCondition,
  getConditionVisual,
  getToothVisual,
} from "@/lib/odontogram-domain"
import { describeTooth, type ToothSurface } from "@/lib/tooth-catalog"

// ===========================================================================
// DETALHE DO DENTE (Parte 5 — Odontograma).
//
// Painel lateral que abre ao clicar em um dente. É uma das principais
// interfaces clínicas do sistema: mostra a SITUAÇÃO ATUAL, as CONDIÇÕES
// ativas, os PROCEDIMENTOS e a TIMELINE (histórico) daquele dente.
//
// A timeline é SOMENTE LEITURA: registros históricos não são apagados por
// aqui. Correções são feitas adicionando novos eventos.
// ===========================================================================

export interface ToothEventView {
  id: string
  toothNumber: string
  dentition: string
  kind: "condition" | "procedure"
  code: string
  label: string
  surfaces: ToothSurface[]
  status: string
  procedureId: string | null
  procedureCode: string | null
  procedurePrice: number | null
  notes: string | null
  professionalName: string | null
  appointmentId: string
  attendanceCode: string
  occurredAt: string
}

export interface ToothDetailData {
  patient: { id: string; fullName: string }
  tooth: {
    number: string
    dentition: string
    type: string
    description: string
    status: string
    conditionCodes: string[]
    lastEventAt: string | null
  }
  activeConditions: Array<{
    code: string
    name: string
    category: string
    surfaces: ToothSurface[]
  }>
  timeline: ToothEventView[]
}

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  planned: "Planejado",
  performed: "Realizado",
  resolved: "Resolvido",
  cancelled: "Cancelado",
}

interface ToothDetailPanelProps {
  attendanceId: string
  toothNumber: string
  // Habilita as ações de escrita (somente atendimento em andamento).
  canEdit: boolean
  onClose: () => void
  onOpenNewEvent: (toothNumber: string) => void
  // Permite que o odontograma recarregue após uma transição de status.
  onChanged: () => void
}

export function ToothDetailPanel({
  attendanceId,
  toothNumber,
  canEdit,
  onClose,
  onOpenNewEvent,
  onChanged,
}: ToothDetailPanelProps) {
  const [busyEventId, setBusyEventId] = useState<string | null>(null)
  const [actionError, setActionError] = useState("")

  // A URL é derivada dos props; o hook cuida do ciclo de carga e de corridas.
  const load = useCallback(
    () =>
      fetch(`/api/attendance/${attendanceId}/odontogram/tooth/${toothNumber}`, {
        cache: "no-store",
      }).then((res) => res.json() as Promise<ToothDetailData>),
    [attendanceId, toothNumber]
  )

  const {
    data,
    error: loadError,
    isLoading,
    reload,
  } = useAsyncData<ToothDetailData>(load, [attendanceId, toothNumber])

  const error = loadError ? "Não foi possível carregar o dente." : ""

  // Fecha o painel com ESC (acessibilidade).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function handleTransition(
    eventId: string,
    status: "performed" | "cancelled"
  ) {
    setBusyEventId(eventId)
    setActionError("")
    try {
      const res = await fetch(
        `/api/attendance/${attendanceId}/odontogram/events/${eventId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      )
      if (res.ok) {
        // Recarrega o detalhe do dente após a mutação, sem duplicar lógica.
        await reload()
        onChanged()
        return
      }
      const err = await res.json().catch(() => ({}))
      setActionError(err.error || "Não foi possível atualizar o procedimento.")
    } catch {
      setActionError("Erro de conexão. Tente novamente.")
    } finally {
      setBusyEventId(null)
    }
  }

  const visual = data ? getToothVisual(data.tooth.status) : null
  const conditions = data?.timeline.filter((e) => e.kind === "condition") ?? []
  const procedures = data?.timeline.filter((e) => e.kind === "procedure") ?? []

  return (
    <>
      {/* Overlay */}
      <button
        type="button"
        aria-label="Fechar detalhe do dente"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-gray-900/20 backdrop-blur-[1px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhe do dente ${toothNumber}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-2xl sm:max-w-lg"
      >
        {/* Cabeçalho */}
        <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900">
                DENTE {toothNumber}
              </h2>
              {visual && (
                <span
                  className={cn("h-2.5 w-2.5 rounded-full", visual.dot)}
                  aria-hidden="true"
                />
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {describeTooth(toothNumber)}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando dente...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
              <AlertTriangle className="mb-1 h-4 w-4" />
              {error}
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={load}
              >
                Tentar novamente
              </Button>
            </div>
          ) : data ? (
            <div className="space-y-6">
              {/* Situação atual */}
              <section>
                <SectionTitle>Situação atual</SectionTitle>
                <div
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
                    visual?.chip
                  )}
                >
                  <span
                    className={cn("h-2.5 w-2.5 shrink-0 rounded-full", visual?.dot)}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold">
                    {statusLabel(data.tooth.status)}
                  </span>
                </div>
              </section>

              {/* Condições ativas */}
              <section>
                <div className="flex items-center justify-between gap-2">
                  <SectionTitle>Condições</SectionTitle>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onOpenNewEvent(toothNumber)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                    >
                      <Plus className="h-3 w-3" />
                      Adicionar condição
                    </button>
                  )}
                </div>

                {data.activeConditions.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500">
                    Nenhuma condição ativa registrada. O dente está representado
                    como saudável.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.activeConditions.map((condition) => {
                      const conditionVisual = getConditionVisual(condition.code)
                      return (
                        <li
                          key={condition.code}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-lg border px-3 py-2",
                            conditionVisual.chip
                          )}
                        >
                          <span className="text-sm font-medium">
                            {condition.name}
                          </span>
                          {condition.surfaces.length > 0 && (
                            <span className="shrink-0 text-xs font-semibold">
                              {formatSurfaces(
                                condition.surfaces.join(","),
                                data.tooth.type as never
                              )}
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {/* Procedimentos */}
              <section>
                <SectionTitle>Procedimentos</SectionTitle>
                {procedures.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500">
                    Nenhum procedimento registrado para este dente.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {procedures.map((procedure) => (
                      <li
                        key={procedure.id}
                        className="rounded-lg border border-gray-200 px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">
                              {procedure.label}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {formatEventDateTime(procedure.occurredAt)}
                              {procedure.procedureCode
                                ? ` • ${procedure.procedureCode}`
                                : ""}
                              {procedure.surfaces.length > 0
                                ? ` • ${formatSurfaces(
                                    procedure.surfaces.join(","),
                                    data.tooth.type as never
                                  )}`
                                : ""}
                            </p>
                          </div>
                          <Badge
                            className={cn(
                              "shrink-0",
                              procedure.status === "performed"
                                ? "border-green-200 bg-green-50 text-green-800"
                                : procedure.status === "planned"
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-gray-200 bg-gray-50 text-gray-600"
                            )}
                          >
                            {STATUS_LABELS[procedure.status] ?? procedure.status}
                          </Badge>
                        </div>

                        {procedure.notes && (
                          <p className="mt-1.5 text-xs italic text-gray-600">
                            “{procedure.notes}”
                          </p>
                        )}

                        {/* Transição PLANEJADO -> REALIZADO (gancho do Plano). */}
                        {canEdit && procedure.status === "planned" && (
                          <div className="mt-2 flex gap-2">
                            <Button
                              size="sm"
                              disabled={busyEventId === procedure.id}
                              onClick={() =>
                                handleTransition(procedure.id, "performed")
                              }
                            >
                              {busyEventId === procedure.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              Marcar como realizado
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyEventId === procedure.id}
                              onClick={() =>
                                handleTransition(procedure.id, "cancelled")
                              }
                            >
                              Cancelar
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Timeline do dente (somente leitura) */}
              <section>
                <div className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-gray-400" />
                  <SectionTitle>Histórico do dente</SectionTitle>
                </div>

                {data.timeline.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500">
                    Sem eventos registrados.
                  </p>
                ) : (
                  <ol className="relative mt-2 space-y-3 border-l border-gray-200 pl-4">
                    {data.timeline.map((event) => (
                      <TimelineItem
                        key={event.id}
                        event={event}
                        toothType={data.tooth.type}
                      />
                    ))}
                  </ol>
                )}
                <p className="mt-2 text-[11px] text-gray-400">
                  O histórico é permanente. Correções são feitas adicionando
                  novos registros, nunca apagando os anteriores.
                </p>
              </section>

              {actionError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {actionError}
                </div>
              )}

              {conditions.length > 0 && procedures.length === 0 && (
                <p className="text-[11px] text-gray-400">
                  Condições descrevem o que foi encontrado; procedimentos
                  descrevem o que foi feito. São registros diferentes.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <footer className="border-t border-gray-100 px-5 py-3">
          <div className="flex gap-2">
            {canEdit && (
              <Button
                size="sm"
                onClick={() => onOpenNewEvent(toothNumber)}
                className="flex-1"
              >
                <Plus className="h-4 w-4" />
                Novo registro
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </footer>
      </aside>
    </>
  )
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
      {children}
    </h3>
  )
}

function TimelineItem({
  event,
  toothType,
}: {
  event: ToothEventView
  toothType: string
}) {
  const condition = event.kind === "condition" ? getCondition(event.code) : null
  const visual = getConditionVisual(event.code)

  return (
    <li className="relative">
      <span
        className={cn(
          "absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white",
          visual.dot
        )}
        aria-hidden="true"
      />
      <p className="text-[11px] font-semibold tabular-nums text-gray-400">
        {formatEventDateTime(event.occurredAt)}
      </p>
      <p className="text-sm font-medium text-gray-900">
        {event.label}
        {event.surfaces.length > 0 && (
          <span className="ml-1.5 text-xs font-normal text-gray-500">
            ({formatSurfaces(event.surfaces.join(","), toothType as never)})
          </span>
        )}
      </p>
      <p className="text-[11px] text-gray-500">
        {event.kind === "condition" ? "Condição" : "Procedimento"}
        {event.kind === "procedure" ? ` • ${STATUS_LABELS[event.status] ?? event.status}` : ""}
        {event.professionalName ? ` • ${event.professionalName}` : ""}
        {` • Atendimento #${event.attendanceCode}`}
      </p>
      {event.notes && (
        <p className="mt-0.5 text-xs italic text-gray-600">“{event.notes}”</p>
      )}
      {condition?.scope === "surface" && event.surfaces.length === 0 && (
        <p className="mt-0.5 text-[11px] text-amber-700">
          Registro sem superfície especificada.
        </p>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusLabel(status: string): string {
  const condition = getCondition(status)
  if (condition) return condition.name
  return status === "healthy" ? "Saudável" : status
}

function formatEventDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  const day = date.toLocaleDateString("pt-BR")
  const time = date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })
  return `${day} ${time}`
}
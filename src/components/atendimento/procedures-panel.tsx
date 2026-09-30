"use client"

import { useCallback, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { useAsyncData } from "@/lib/use-async-data"
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type ProcedureComparisonResult,
  type ProcedureExecutionStatus,
  type ProcedureOrigin,
  PROCEDURE_ORIGIN_LABELS,
} from "@/lib/procedure-execution-domain"
import { ProcedureStatusBadge, formatCurrency, formatDateTime } from "./procedure-ui"
import {
  ProcedureFormModal,
  type ProcedureFormTarget,
} from "./procedure-form-modal"

// ===========================================================================
// PROCEDIMENTOS DO ATENDIMENTO — Parte 7.
//
// Responde imediatamente: "o que estava previsto para este paciente hoje e o
// que realmente foi feito?".
//
// - Seção PREVISTOS: o que veio da Agenda (registro histórico, não apagável).
// - Seção REALIZADOS / REGISTRADOS: a execução do atendimento.
// - Comparação visual previsto x realizado por procedimento.
//
// O paciente é SEMPRE resolvido no servidor a partir do atendimento.
// ===========================================================================

interface ScheduledProcedureView {
  id: string
  procedureId: string
  procedureNameSnapshot: string
  unitPrice: number
  quantity: number
  totalPrice: number
  executionId: string | null
  origin: ProcedureOrigin
}

interface ProcedureExecutionView {
  id: string
  procedureId: string
  procedureNameSnapshot: string
  procedureCodeSnapshot: string | null
  origin: ProcedureOrigin
  scheduledProcedureId: string | null
  status: ProcedureExecutionStatus
  reasonCode: string | null
  reasonLabel: string | null
  reasonNote: string | null
  toothNumber: string | null
  dentition: string | null
  surfaces: string[]
  catalogPriceSnapshot: number | null
  expectedPrice: number | null
  performedPrice: number | null
  comparison: ProcedureComparisonResult
  valueDifference: number | null
  valueDiffers: boolean
  notes: string | null
  professionalName: string | null
  odontogramEventId: string | null
  performedAt: string | null
  createdAt: string
}

interface ProceduresApiResponse {
  appointment: {
    id: string
    code: string
    date: string
    time: string | null
    status: string
    isOpen: boolean
  }
  patient: { id: string; fullName: string; cpf: string }
  professional: { id: string; name: string } | null
  scheduled: ScheduledProcedureView[]
  executions: ProcedureExecutionView[]
  summary: {
    scheduledCount: number
    performedCount: number
    notPerformedCount: number
    pendingCount: number
    addedCount: number
    expectedTotal: number
    performedTotal: number
    differenceTotal: number
    hasValueDifference: boolean
  }
  catalog: { reasons: Array<{ code: string; label: string }> }
}

interface ProcedureCatalogOption {
  id: string
  name: string
  code: string
  category: string
  defaultPrice: number | null
  allowPriceOverride: boolean
  active: boolean
}

interface ProceduresPanelProps {
  attendanceId: string
  onSaved?: () => void
}

type StatusFilter = "all" | ProcedureExecutionStatus
type OriginFilter = "all" | ProcedureOrigin
type TabKey = "all" | "scheduled" | "executed"

function formatDate(value: string): string {
  const iso = value.length <= 10 ? `${value}T00:00:00` : value
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("pt-BR")
}

export function ProceduresPanel({ attendanceId, onSaved }: ProceduresPanelProps) {
  const [notice, setNotice] = useState("")
  const [info, setInfo] = useState("")

  const [tab, setTab] = useState<TabKey>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all")
  const [query, setQuery] = useState("")

  const [formTarget, setFormTarget] = useState<ProcedureFormTarget | null>(null)
  const [formMode, setFormMode] = useState<"perform" | "not_performed">("perform")

  const [catalog, setCatalog] = useState<ProcedureCatalogOption[]>([])
  const [catalogQuery, setCatalogQuery] = useState("")
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false)
  const [showCatalogPicker, setShowCatalogPicker] = useState(false)

  const load = useCallback(
    async () => {
      const res = await fetch(`/api/attendance/${attendanceId}/procedures`, {
        cache: "no-store",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Não foi possível carregar os procedimentos.")
      }
      return (await res.json()) as ProceduresApiResponse
    },
    [attendanceId]
  )

  const {
    data,
    error,
    isLoading,
    reload: reloadProcedures,
  } = useAsyncData<ProceduresApiResponse>(load, [attendanceId])

  const loadCatalog = useCallback(async () => {
    setIsLoadingCatalog(true)
    try {
      const res = await fetch("/api/procedures", { cache: "no-store" })
      if (res.ok) {
        const payload = await res.json()
        setCatalog(
          Array.isArray(payload) ? payload : (payload?.procedures ?? [])
        )
      } else {
        setCatalog([])
      }
    } catch {
      setCatalog([])
    } finally {
      setIsLoadingCatalog(false)
    }
  }, [])

  // O catálogo só é buscado quando o seletor é aberto — nunca no mount.
  const handleOpenCatalogPicker = useCallback(() => {
    setShowCatalogPicker(true)
    if (catalog.length === 0) void loadCatalog()
  }, [catalog.length, loadCatalog])

  const filteredCatalog = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase()
    if (!q) return catalog.slice(0, 40)
    return catalog
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
      )
      .slice(0, 40)
  }, [catalog, catalogQuery])

  const filteredExecutions = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.executions.filter((execution) => {
      if (tab === "scheduled" && execution.origin !== "scheduled") return false
      if (tab === "executed" && execution.origin !== "added_in_attendance")
        return false
      if (statusFilter !== "all" && execution.status !== statusFilter) return false
      if (originFilter !== "all" && execution.origin !== originFilter) return false
      if (q && !execution.procedureNameSnapshot.toLowerCase().includes(q))
        return false
      return true
    })
  }, [data, tab, statusFilter, originFilter, query])

  const filteredScheduled = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.scheduled.filter((item) => {
      if (tab === "executed") return false
      if (originFilter !== "all" && originFilter !== "scheduled") return false
      if (q && !item.procedureNameSnapshot.toLowerCase().includes(q)) return false
      if (statusFilter !== "all") {
        const execution = data.executions.find((e) => e.id === item.executionId)
        const status = execution?.status ?? "pending"
        if (status !== statusFilter) return false
      }
      return true
    })
  }, [data, tab, originFilter, query, statusFilter])

  function openExecutionForm(
    execution: ProcedureExecutionView,
    mode: "perform" | "not_performed"
  ) {
    const procedure = catalog.find((p) => p.id === execution.procedureId)
    setFormMode(mode)
    setFormTarget({
      executionId: execution.id,
      procedureId: execution.procedureId,
      procedureName: execution.procedureNameSnapshot,
      expectedPrice: execution.expectedPrice,
      catalogPrice: execution.catalogPriceSnapshot ?? procedure?.defaultPrice ?? null,
      allowPriceOverride: procedure?.allowPriceOverride ?? true,
      toothNumber: execution.toothNumber,
      dentition: execution.dentition,
      surfaces: execution.surfaces,
      performedPrice: execution.performedPrice,
      notes: execution.notes,
      professionalName: execution.professionalName,
      isScheduled: execution.origin === "scheduled",
    })
  }

  function openScheduledForm(item: ScheduledProcedureView) {
    setFormMode("perform")
    setFormTarget({
      executionId: null,
      procedureId: item.procedureId,
      procedureName: item.procedureNameSnapshot,
      expectedPrice: item.totalPrice,
      catalogPrice: null,
      allowPriceOverride: true,
      toothNumber: null,
      dentition: "permanent",
      surfaces: [],
      performedPrice: item.totalPrice,
      notes: null,
      professionalName: null,
      isScheduled: true,
    })
  }

  function findExecutionForScheduled(item: ScheduledProcedureView) {
    if (!data || !item.executionId) return null
    return data.executions.find((e) => e.id === item.executionId) ?? null
  }

  async function handleSaved(message: string) {
    setFormTarget(null)
    setShowCatalogPicker(false)
    setNotice(message)
    setInfo("")
    await reloadProcedures()
    onSaved?.()
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando procedimentos...
        </CardContent>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle className="h-12 w-12 text-red-300" />
          <h3 className="mt-3 text-base font-medium text-gray-900">
            {error || "Não foi possível carregar os procedimentos."}
          </h3>
          <Button variant="outline" className="mt-4" onClick={() => reloadProcedures()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  const canEdit = data.appointment.isOpen
  const hasAnyProcedure = data.scheduled.length > 0 || data.executions.length > 0

  const summaryCards = [
    {
      key: "scheduled",
      label: "Previstos",
      value: String(data.summary.scheduledCount),
      icon: <ClipboardList className="h-4 w-4 text-blue-600" />,
    },
    {
      key: "performed",
      label: "Realizados",
      value: String(data.summary.performedCount),
      icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
    },
    {
      key: "not_performed",
      label: "Não realizados",
      value: String(data.summary.notPerformedCount),
      icon: <XCircle className="h-4 w-4 text-gray-500" />,
    },
    {
      key: "value",
      label: "Valor realizado",
      value: formatCurrency(data.summary.performedTotal),
      icon: <Stethoscope className="h-4 w-4 text-emerald-600" />,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900">Procedimentos</h2>
          <p className="text-sm text-gray-500">
            Previstos e realizados neste atendimento
          </p>

          <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            <div>
              <dt className="inline text-gray-400">Paciente: </dt>
              <dd className="inline font-medium text-gray-800">
                {data.patient.fullName}
              </dd>
            </div>
            <div>
              <dt className="inline text-gray-400">Atendimento: </dt>
              <dd className="inline font-semibold tabular-nums text-gray-800">
                #{data.appointment.code}
              </dd>
            </div>
            <div>
              <dt className="inline text-gray-400">Data: </dt>
              <dd className="inline font-medium text-gray-800">
                {formatDate(data.appointment.date)}
              </dd>
            </div>
            {data.professional && (
              <div>
                <dt className="inline text-gray-400">Profissional: </dt>
                <dd className="inline font-medium text-gray-800">
                  {data.professional.name}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => reloadProcedures()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
          <Button
            size="sm"
            onClick={handleOpenCatalogPicker}
            disabled={!canEdit}
            title={
              canEdit
                ? "Adicionar procedimento durante o atendimento"
                : "Inicie o atendimento para registrar procedimentos"
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar procedimento
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div
            key={card.key}
            className="rounded-lg border border-gray-200 bg-white p-3"
          >
            <div className="flex items-center gap-2">
              {card.icon}
              <span className="text-xs font-medium text-gray-500">{card.label}</span>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {data.summary.hasValueDifference && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Existem procedimentos com valor diferente do previsto. Total previsto:{" "}
            <strong>{formatCurrency(data.summary.expectedTotal)}</strong> • Total
            realizado: <strong>{formatCurrency(data.summary.performedTotal)}</strong>{" "}
            • Diferença: <strong>{formatCurrency(data.summary.differenceTotal)}</strong>
          </span>
        </div>
      )}

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {notice}
          </span>
          <button
            className="text-xs font-medium hover:underline"
            onClick={() => setNotice("")}
          >
            Fechar
          </button>
        </div>
      )}
      {info && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {info}
          </span>
          <button
            className="text-xs font-medium hover:underline"
            onClick={() => setInfo("")}
          >
            Fechar
          </button>
        </div>
      )}

      {hasAnyProcedure && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { value: "all", label: "Todos" },
                { value: "scheduled", label: "Da Agenda" },
                { value: "executed", label: "Adicionados no atendimento" },
              ] as const
            ).map((item) => (
              <button
                key={item.value}
                onClick={() => setTab(item.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  tab === item.value
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-200 text-gray-600 hover:bg-gray-100"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Buscar procedimento..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Filtrar por status"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="all">Todos os status</option>
              <option value="pending">Aguardando realização</option>
              <option value="performed">Realizados</option>
              <option value="not_performed">Não realizados</option>
              <option value="cancelled">Cancelados</option>
            </select>
            <select
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value as OriginFilter)}
              aria-label="Filtrar por origem"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="all">Todas as origens</option>
              <option value="scheduled">Agenda</option>
              <option value="added_in_attendance">Adicionado no atendimento</option>
            </select>
          </div>
        </div>
      )}

      {!hasAnyProcedure ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Stethoscope className="h-12 w-12 text-gray-300" />
            <h3 className="mt-3 text-base font-medium text-gray-900">
              Nenhum procedimento neste atendimento
            </h3>
            <p className="mt-1 max-w-md text-sm text-gray-500">
              Não há procedimentos previstos na Agenda nem registros feitos durante
              o atendimento.
            </p>
            <p className="mt-1 max-w-md text-xs text-gray-400">
              Registre o que foi realizado mesmo sem dente (ex.: profilaxia, avaliação).
            </p>
            {canEdit && (
              <Button
                className="mt-4"
                size="sm"
                onClick={handleOpenCatalogPicker}
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar procedimento
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {tab !== "executed" && (
            <section aria-labelledby="procedures-scheduled-heading">
              <h3
                id="procedures-scheduled-heading"
                className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900"
              >
                <ClipboardList className="h-4 w-4 text-blue-600" />
                Procedimentos previstos
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                  {filteredScheduled.length}
                </span>
              </h3>

              {filteredScheduled.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-500">
                  Nenhum procedimento previsto corresponde aos filtros.
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredScheduled.map((item) => {
                    const execution = findExecutionForScheduled(item)
                    return (
                      <ScheduledProcedureCard
                        key={item.id}
                        item={item}
                        execution={execution}
                        canEdit={canEdit}
                        onRegister={() => {
                          if (execution) {
                            openExecutionForm(execution, "perform")
                          } else {
                            openScheduledForm(item)
                          }
                        }}
                        onNotPerformed={() => {
                          if (execution) openExecutionForm(execution, "not_performed")
                        }}
                      />
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {tab !== "scheduled" && (
            <section aria-labelledby="procedures-executions-heading">
              <h3
                id="procedures-executions-heading"
                className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900"
              >
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Procedimentos realizados
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                  {filteredExecutions.length}
                </span>
              </h3>

              {filteredExecutions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-500">
                  Nenhum procedimento registrado corresponde aos filtros.
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredExecutions.map((execution) => (
                    <ExecutionCard
                      key={execution.id}
                      execution={execution}
                      canEdit={canEdit}
                      onPerform={() => openExecutionForm(execution, "perform")}
                      onNotPerformed={() =>
                        openExecutionForm(execution, "not_performed")
                      }
                      onViewOdontogram={() =>
                        setInfo(
                          "O evento clínico gerado por este procedimento pode ser conferido no Odontograma."
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {showCatalogPicker && (
        <>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setShowCatalogPicker(false)}
            className="fixed inset-0 z-40 cursor-default bg-gray-900/30"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Adicionar procedimento"
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  Adicionar procedimento
                </h2>
                <p className="text-xs text-gray-500">
                  O procedimento não estava na Agenda e será registrado neste
                  atendimento.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCatalogPicker(false)}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Buscar no catálogo de procedimentos..."
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>

              {isLoadingCatalog ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando catálogo...
                </div>
              ) : filteredCatalog.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-500">
                  Nenhum procedimento encontrado. Cadastre em Procedimentos.
                </p>
              ) : (
                <ul className="space-y-1">
                  {filteredCatalog.map((procedure) => (
                    <li key={procedure.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCatalogPicker(false)
                          setFormMode("perform")
                          setFormTarget({
                            executionId: null,
                            procedureId: procedure.id,
                            procedureName: procedure.name,
                            expectedPrice: null,
                            catalogPrice: procedure.defaultPrice,
                            allowPriceOverride: procedure.allowPriceOverride,
                            toothNumber: null,
                            dentition: "permanent",
                            surfaces: [],
                            performedPrice: procedure.defaultPrice,
                            notes: null,
                            professionalName: null,
                            isScheduled: false,
                          })
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Stethoscope className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-gray-900">
                              {procedure.name}
                            </span>
                            <span className="block text-[11px] text-gray-500">
                              {procedure.code} • {procedure.category}
                            </span>
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-medium tabular-nums text-gray-600">
                          {formatCurrency(procedure.defaultPrice)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {formTarget && (
        <ProcedureFormModal
          attendanceId={attendanceId}
          target={{
            ...formTarget,
            allowPriceOverride:
              formTarget.allowPriceOverride &&
              (catalog.find((p) => p.id === formTarget.procedureId)
                ?.allowPriceOverride ??
                formTarget.allowPriceOverride),
          }}
          initialMode={formMode}
          canEdit={canEdit}
          onClose={() => setFormTarget(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

function ScheduledProcedureCard({
  item,
  execution,
  canEdit,
  onRegister,
  onNotPerformed,
}: {
  item: ScheduledProcedureView
  execution: ProcedureExecutionView | null
  canEdit: boolean
  onRegister: () => void
  onNotPerformed: () => void
}) {
  const status: ProcedureExecutionStatus = execution?.status ?? "pending"

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900">
              {item.procedureNameSnapshot}
            </h4>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
              Origem: Agenda
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>
              {execution?.toothNumber
                ? `Dente ${execution.toothNumber}`
                : "Dente: —"}
            </span>
            {execution && execution.surfaces.length > 0 && (
              <span>Superfície: {execution.surfaces.join(", ")}</span>
            )}
            <span>
              Valor previsto:{" "}
              <strong className="font-semibold text-gray-700">
                {formatCurrency(item.totalPrice)}
              </strong>
            </span>
            {item.quantity > 1 && <span>Quantidade: {item.quantity}</span>}
          </div>

          <div className="mt-2">
            <ProcedureStatusBadge status={status} />
          </div>
        </div>

        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onRegister}>
              {status === "performed" ? "Revisar registro" : "Registrar"}
            </Button>
            {status !== "performed" && status !== "not_performed" && (
              <Button size="sm" variant="ghost" onClick={onNotPerformed}>
                Não realizado
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function ExecutionCard({
  execution,
  canEdit,
  onPerform,
  onNotPerformed,
  onViewOdontogram,
}: {
  execution: ProcedureExecutionView
  canEdit: boolean
  onPerform: () => void
  onNotPerformed: () => void
  onViewOdontogram: () => void
}) {
  const performed = execution.status === "performed"
  const performedAt = formatDateTime(execution.performedAt)

  return (
    <article
      className={cn(
        "rounded-xl border bg-white p-3.5 shadow-sm",
        performed
          ? "border-l-4 border-green-200 border-l-green-500"
          : "border-gray-200"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              {performed && (
                <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
              )}
              {execution.procedureNameSnapshot}
            </h4>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                execution.origin === "scheduled"
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-indigo-200 bg-indigo-50 text-indigo-700"
              )}
            >
              {PROCEDURE_ORIGIN_LABELS[execution.origin]}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            {execution.toothNumber ? (
              <span>
                Dente {execution.toothNumber}
                {execution.surfaces.length > 0
                  ? ` • ${execution.surfaces.join(", ")}`
                  : ""}
              </span>
            ) : (
              <span>Sem dente</span>
            )}
            {performed && execution.performedPrice !== null && (
              <span>
                Valor realizado:{" "}
                <strong className="font-semibold text-gray-700">
                  {formatCurrency(execution.performedPrice)}
                </strong>
              </span>
            )}
            {performedAt && <span>{performedAt}</span>}
            {execution.professionalName && <span>{execution.professionalName}</span>}
          </div>

          {performed && execution.valueDiffers && (
            <p className="mt-1.5 inline-flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
              Valor diferente do previsto — Previsto:{" "}
              {formatCurrency(execution.expectedPrice)} • Realizado:{" "}
              {formatCurrency(execution.performedPrice)} • Diferença:{" "}
              {formatCurrency(execution.valueDifference)}
            </p>
          )}

          {execution.status === "not_performed" && (
            <p className="mt-1.5 text-[11px] font-medium text-gray-600">
              Motivo: {execution.reasonLabel ?? "—"}
              {execution.reasonNote ? ` • ${execution.reasonNote}` : ""}
            </p>
          )}

          {execution.notes && (
            <p className="mt-1.5 text-xs italic text-gray-500">{execution.notes}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ProcedureStatusBadge status={execution.status} />
            {execution.odontogramEventId && (
              <button
                type="button"
                onClick={onViewOdontogram}
                className="text-[11px] font-medium text-blue-700 hover:underline"
              >
                Ver no odontograma
              </button>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!performed && (
              <Button size="sm" variant="outline" onClick={onPerform}>
                Registrar
              </Button>
            )}
            {execution.status !== "not_performed" && (
              <Button size="sm" variant="ghost" onClick={onNotPerformed}>
                Não realizado
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

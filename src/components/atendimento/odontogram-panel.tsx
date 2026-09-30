"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  CONDITION_CATALOG,
  HEALTHY_CODE,
  getCondition,
  getToothVisual,
} from "@/lib/odontogram-domain"
import {
  type Arch,
  type Dentition,
  type ToothSurface,
  DENTITION_LABELS,
  buildOdontogramRows,
  getToothDefinition,
} from "@/lib/tooth-catalog"
import { ToothGlyph, type SurfaceCondition } from "./odontogram-tooth"
import { ToothDetailPanel } from "./odontogram-tooth-detail"
import { OdontogramEventModal } from "./odontogram-event-modal"

// ===========================================================================
// ODONTOGRAMA (Parte 5) — área do prontuário único.
//
// O desenho é a REPRESENTAÇÃO dos dados clínicos. Alterna entre dentição
// PERMANENTE e DECÍDUA, mostra o estado ATUAL de cada dente e permite abrir o
// detalhe (situação + condições + procedimentos + histórico).
// ===========================================================================

interface ApiToothState {
  number: string
  dentition: Dentition
  type: string
  arch: string
  quadrant: number
  description: string
  status: string
  conditionCodes: string[]
  hasHistory: boolean
  lastEventAt: string | null
}

interface ApiEvent {
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

interface OdontogramApiResponse {
  patient: { id: string; fullName: string }
  attendance: { id: string; code: string; status: string; isOpen: boolean }
  dentition: Dentition
  teeth: ApiToothState[]
  currentEvents: ApiEvent[]
  // Dentes com tratamento PLANEJADO (Parte 10.1) — indicação visual apenas
  // (não altera o estado clínico do dente).
  plannedTeeth: string[]
  summary: {
    totalTeeth: number
    withFindings: number
    healthy: number
    absent: number
  }
}

interface OdontogramPanelProps {
  attendanceId: string
}

export function OdontogramPanel({ attendanceId }: OdontogramPanelProps) {
  const [dentition, setDentition] = useState<Dentition>("permanent")
  const [data, setData] = useState<OdontogramApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const [openTooth, setOpenTooth] = useState<string | null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [modalTooth, setModalTooth] = useState<string | null>(null)

  // Recarrega exibindo o estado de carregamento (usado pelo botão Atualizar).
  const reload = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(
        `/api/attendance/${attendanceId}/odontogram?dentition=${dentition}`,
        { cache: "no-store" }
      )
      if (res.ok) {
        setData((await res.json()) as OdontogramApiResponse)
        setError("")
      } else {
        const err = await res.json().catch(() => ({}))
        setError(err.error || "Não foi possível carregar o odontograma.")
        setData(null)
      }
    } catch {
      setError("Erro de conexão. Tente novamente.")
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [attendanceId, dentition])

  // Carga inicial — fetch direto no effect, sem setState síncrono no corpo.
  useEffect(() => {
    let cancelled = false
    fetch(
      `/api/attendance/${attendanceId}/odontogram?dentition=${dentition}`,
      { cache: "no-store" }
    )
      .then((res) => {
        if (cancelled) return null
        return res.ok ? res.json() : null
      })
      .then((json) => {
        if (cancelled) return
        if (json) {
          setData(json as OdontogramApiResponse)
          setError("")
        } else {
          setError("Não foi possível carregar o odontograma.")
          setData(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Erro de conexão. Tente novamente.")
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [attendanceId, dentition])

  const toothByNumber = useMemo(() => {
    const map = new Map<string, ApiToothState>()
    for (const tooth of data?.teeth ?? []) map.set(tooth.number, tooth)
    return map
  }, [data])

  // Superfícies com condição ativa POR DENTE — derivadas dos eventos do
  // atendimento atual. O dente só "pinta" uma região quando há dado clínico
  // real registrado; nunca por pintura manual do usuário.
  const surfaceConditionsByTooth = useMemo(() => {
    const map = new Map<string, SurfaceCondition[]>()
    if (!data) return map

    const active = data.currentEvents.filter(
      (e) => e.kind === "condition" && e.status === "active"
    )

    for (const event of active) {
      const existing = map.get(event.toothNumber) ?? []
      for (const surface of event.surfaces) {
        if (!existing.some((s) => s.surface === surface)) {
          existing.push({ surface, code: event.code })
        }
      }
      map.set(event.toothNumber, existing)
    }

    return map
  }, [data])

  const currentEventTeeth = useMemo(
    () => new Set((data?.currentEvents ?? []).map((e) => e.toothNumber)),
    [data]
  )

  // Dentes com tratamento planejado (Parte 10.1). Usados apenas para indicar
  // visualmente que existe um plano — o estado clínico permanece intocado.
  const plannedTeeth = useMemo(
    () => new Set(data?.plannedTeeth ?? []),
    [data]
  )

  const rows = useMemo(() => buildOdontogramRows(dentition), [dentition])

  const canEdit = data?.attendance.isOpen ?? false

  function openNewEvent(toothNumber: string | null) {
    setModalTooth(toothNumber)
    setShowEventModal(true)
  }

  function handleSaved(message: string) {
    setShowEventModal(false)
    setModalTooth(null)
    setNotice(message)
    void reload()
    window.setTimeout(() => setNotice(""), 4000)
  }

  const legendItems = useMemo(() => {
    // Legenda derivada do catálogo real (sem lista paralela na tela).
    const priority = [
      "healthy",
      "caries",
      "restoration",
      "fracture",
      "absent",
      "extracted",
      "endodontic",
      "crown",
      "implant",
      "sealant",
    ]
    return priority
      .map((code) => CONDITION_CATALOG.find((c) => c.code === code))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
  }, [])

  return (
    <div className="space-y-4">
      {/* Cabeçalho da área */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Odontograma</h2>
          <p className="text-sm text-gray-500">
            Situação odontológica atual do paciente
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={isLoading}
            title="Recarregar"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            Atualizar
          </Button>
          <Button
            size="sm"
            onClick={() => openNewEvent(null)}
            disabled={!canEdit}
            title={
              canEdit
                ? undefined
                : "Inicie o atendimento para registrar no odontograma."
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Novo registro
          </Button>
        </div>
      </div>

      {/* Controles de visualização */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Dentição
        </span>
        <div className="flex gap-1.5">
          {(["permanent", "deciduous"] as Dentition[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDentition(option)}
              aria-pressed={dentition === option}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                dentition === option
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-200 text-gray-600 hover:bg-gray-100"
              )}
            >
              {DENTITION_LABELS[option]}
            </button>
          ))}
        </div>

        {data && (
          <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
            <span>
              <strong className="font-semibold text-gray-700">
                {data.summary.totalTeeth}
              </strong>{" "}
              dentes
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {data.summary.withFindings} com achados
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {data.summary.healthy} sem achados
            </span>
          </div>
        )}
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {notice}
        </div>
      )}

      {/* Odontograma */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-20 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando odontograma...
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-16 text-center">
          <AlertTriangle className="h-10 w-10 text-red-300" />
          <p className="mt-3 text-sm font-medium text-gray-900">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={reload}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <ArchRows
            rows={rows}
            toothByNumber={toothByNumber}
            surfaceConditionsByTooth={surfaceConditionsByTooth}
            currentEventTeeth={currentEventTeeth}
            plannedTeeth={plannedTeeth}
            selectedTooth={openTooth}
            onSelectTooth={setOpenTooth}
          />
        </div>
      )}

      {/* Legenda */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Legenda
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {legendItems.map((condition) => {
            const visual = getToothVisual(condition.code)
            return (
              <span
                key={condition.code}
                className="inline-flex items-center gap-1.5 text-xs text-gray-600"
                title={condition.description}
              >
                <span
                  className={cn("h-2.5 w-2.5 rounded-full", visual.dot)}
                  aria-hidden="true"
                />
                {condition.name}
              </span>
            )
          })}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-gray-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          O desenho representa os dados registrados. Cada região destacada
          corresponde a uma superfície com condição ativa — não há pintura
          manual.
        </p>
        {/* Indicador de planejamento (Parte 10.1): visual apenas, não é dado
            clínico do dente. */}
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-500">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-600"
            aria-hidden="true"
          />
          Dente com tratamento planejado (Plano de tratamento) — indicação
          visual, não altera o estado clínico.
        </p>
      </div>

      {/* Detalhe do dente */}
      {openTooth && (
        <ToothDetailPanel
          attendanceId={attendanceId}
          toothNumber={openTooth}
          canEdit={canEdit}
          onClose={() => setOpenTooth(null)}
          onOpenNewEvent={(number) => {
            setOpenTooth(null)
            openNewEvent(number)
          }}
          onChanged={reload}
        />
      )}

      {/* Registro de evento */}
      {showEventModal && (
        <OdontogramEventModal
          attendanceId={attendanceId}
          dentition={dentition}
          initialTooth={modalTooth}
          canEdit={canEdit}
          onClose={() => {
            setShowEventModal(false)
            setModalTooth(null)
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Arcadas
// ---------------------------------------------------------------------------

interface ArchRowsProps {
  rows: ReturnType<typeof buildOdontogramRows>
  toothByNumber: Map<string, ApiToothState>
  surfaceConditionsByTooth: Map<string, SurfaceCondition[]>
  currentEventTeeth: Set<string>
  plannedTeeth: Set<string>
  selectedTooth: string | null
  onSelectTooth: (number: string) => void
}

function ArchRows({
  rows,
  toothByNumber,
  surfaceConditionsByTooth,
  currentEventTeeth,
  plannedTeeth,
  selectedTooth,
  onSelectTooth,
}: ArchRowsProps) {
  const upperRight = rows.find((r) => r.arch === "upper" && r.side === "right")
  const upperLeft = rows.find((r) => r.arch === "upper" && r.side === "left")
  const lowerRight = rows.find((r) => r.arch === "lower" && r.side === "right")
  const lowerLeft = rows.find((r) => r.arch === "lower" && r.side === "left")

  return (
    <div className="space-y-1 overflow-x-auto">
      <ArchLabel arch="upper" />

      <div className="flex items-start justify-center gap-1 sm:gap-2">
        <ToothRow
          teeth={upperRight?.teeth ?? []}
          toothByNumber={toothByNumber}
          surfaceConditionsByTooth={surfaceConditionsByTooth}
          currentEventTeeth={currentEventTeeth}
          plannedTeeth={plannedTeeth}
          selectedTooth={selectedTooth}
          onSelectTooth={onSelectTooth}
        />
        <div className="mx-1 h-12 w-px shrink-0 bg-gray-200 sm:mx-3" aria-hidden="true" />
        <ToothRow
          teeth={upperLeft?.teeth ?? []}
          toothByNumber={toothByNumber}
          surfaceConditionsByTooth={surfaceConditionsByTooth}
          currentEventTeeth={currentEventTeeth}
          plannedTeeth={plannedTeeth}
          selectedTooth={selectedTooth}
          onSelectTooth={onSelectTooth}
        />
      </div>

      {/* Linha média */}
      <div className="flex items-center gap-2 py-1">
        <span className="h-px flex-1 bg-gray-100" aria-hidden="true" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-300">
          Linha média
        </span>
        <span className="h-px flex-1 bg-gray-100" aria-hidden="true" />
      </div>

      <div className="flex items-start justify-center gap-1 sm:gap-2">
        <ToothRow
          teeth={lowerRight?.teeth ?? []}
          toothByNumber={toothByNumber}
          surfaceConditionsByTooth={surfaceConditionsByTooth}
          currentEventTeeth={currentEventTeeth}
          plannedTeeth={plannedTeeth}
          selectedTooth={selectedTooth}
          onSelectTooth={onSelectTooth}
        />
        <div className="mx-1 h-12 w-px shrink-0 bg-gray-200 sm:mx-3" aria-hidden="true" />
        <ToothRow
          teeth={lowerLeft?.teeth ?? []}
          toothByNumber={toothByNumber}
          surfaceConditionsByTooth={surfaceConditionsByTooth}
          currentEventTeeth={currentEventTeeth}
          plannedTeeth={plannedTeeth}
          selectedTooth={selectedTooth}
          onSelectTooth={onSelectTooth}
        />
      </div>

      <ArchLabel arch="lower" />
    </div>
  )
}

function ArchLabel({ arch }: { arch: Arch }) {
  return (
    <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400">
      {arch === "upper" ? "Arcada superior" : "Arcada inferior"}
    </p>
  )
}

interface ToothRowProps {
  teeth: ReturnType<typeof buildOdontogramRows>[number]["teeth"]
  toothByNumber: Map<string, ApiToothState>
  surfaceConditionsByTooth: Map<string, SurfaceCondition[]>
  currentEventTeeth: Set<string>
  plannedTeeth: Set<string>
  selectedTooth: string | null
  onSelectTooth: (number: string) => void
}

function ToothRow({
  teeth,
  toothByNumber,
  surfaceConditionsByTooth,
  currentEventTeeth,
  plannedTeeth,
  selectedTooth,
  onSelectTooth,
}: ToothRowProps) {
  return (
    <div className="flex items-start gap-0.5 sm:gap-1">
      {teeth.map((tooth) => {
        const state = toothByNumber.get(tooth.number)
        return (
          <ToothGlyph
            key={tooth.number}
            tooth={tooth}
            status={state?.status ?? HEALTHY_CODE}
            surfaceConditions={surfaceConditionsByTooth.get(tooth.number) ?? []}
            selected={selectedTooth === tooth.number}
            hasCurrentEvent={currentEventTeeth.has(tooth.number)}
            hasPlannedTreatment={plannedTeeth.has(tooth.number)}
            onSelect={onSelectTooth}
          />
        )
      })}
    </div>
  )
}

// Reexport para uso externo quando necessário (ex.: resumo clínico).
export function describeCondition(code: string): string {
  return getCondition(code)?.name ?? code
}

export function toothDescription(number: string): string {
  return getToothDefinition(number)?.number ?? number
}

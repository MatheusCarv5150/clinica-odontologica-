"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Users,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  PlayCircle,
  Clock,
  ShieldCheck,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { PatientDetailsPanel } from "@/components/pacientes/patient-details-panel"
import { PatientFormModal } from "@/components/pacientes/patient-form-modal"
import type { PatientEditable } from "@/app/(dashboard)/pacientes/page"
import {
  type AttendanceQueueItem,
  type AttendanceSummary,
  formatLongDate,
  toBRDate,
  toDateKey,
} from "./attendance-utils"
import { AttendanceQueueRow } from "./attendance-queue-row"
import { PatientHeader } from "./patient-header"

type StatusFilter = "all" | "awaiting_attendance" | "in_progress" | "completed"

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "awaiting_attendance", label: "Aguardando atendimento" },
  { value: "in_progress", label: "Em atendimento" },
  { value: "completed", label: "Concluídos" },
]

// Paciente editável compartilhado entre o painel de detalhes e o modal de
// formulário. Fonte única da verdade: evita divergência de tipos entre telas.
type EditablePatient = PatientEditable

interface AttendanceBoardProps {
  patientIdToOpen?: string | null
  appointmentIdToOpen?: string | null
  onPatientPanelClosed?: () => void
}

export function AttendanceBoard({
  patientIdToOpen,
  appointmentIdToOpen,
  onPatientPanelClosed,
}: AttendanceBoardProps) {
  const [dateKey, setDateKey] = useState<string>(() => toDateKey(new Date()))
  const [items, setItems] = useState<AttendanceQueueItem[]>([])
  const [summary, setSummary] = useState<AttendanceSummary>({
    released: 0,
    awaiting: 0,
    inProgress: 0,
    completed: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionError, setActionError] = useState("")
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [editingPatient, setEditingPatient] = useState<EditablePatient | null>(null)
  // Atendimento aberto: quando presente, o cabeçalho do paciente (Parte 2)
  // assume a tela. A fila permanece montada ao fundo para não perder dados.
  const [openAppointmentId, setOpenAppointmentId] = useState<string | null>(null)

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      params.set("date", dateKey)
      if (query.trim()) params.set("q", query.trim())
      if (statusFilter !== "all") params.set("status", statusFilter)

      const res = await fetch(`/api/attendance?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setItems(Array.isArray(data.items) ? data.items : [])
        if (data.summary) setSummary(data.summary)
      } else {
        const err = await res.json().catch(() => ({}))
        setError(err.error || "Erro ao carregar a fila de atendimento.")
        setItems([])
      }
    } catch {
      setError("Erro de conexão. Tente novamente.")
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [dateKey, query, statusFilter])

  // Debounce da busca (executada no backend)
  useEffect(() => {
    const timer = setTimeout(() => {
      loadQueue()
    }, 300)
    return () => clearTimeout(timer)
  }, [loadQueue])

  // Valores vindos da URL são estados DERIVADOS: o valor local só existe
  // quando o usuário abre algo manualmente. Sincronizar por efeito causaria
  // renders em cascata e poderia reabrir painéis já fechados.
  const detailsPatientId = selectedPatientId ?? patientIdToOpen ?? null
  const activeAppointmentId = openAppointmentId ?? appointmentIdToOpen ?? null

  function navigate(direction: -1 | 1) {
    const [y, m, d] = dateKey.split("-").map(Number)
    const date = new Date(y, m - 1, d)
    date.setDate(date.getDate() + direction)
    setDateKey(toDateKey(date))
  }

  function goToToday() {
    setDateKey(toDateKey(new Date()))
  }

  // Abre o cabeçalho do atendimento e reflete a escolha na URL, permitindo
  // recarregar/voltar sem perder o contexto.
  function openAttendance(appointmentId: string) {
    setOpenAppointmentId(appointmentId)
    setSelectedPatientId(null)
    window.history.replaceState(null, "", `/atendimento?appointment=${appointmentId}`)
  }

  // Retorna para a fila SEM finalizar nem criar atendimento: apenas fecha o
  // cabeçalho e limpa o parâmetro da URL, recarregando a fila para refletir o
  // status atual (inclusive "Em atendimento").
  function closeAttendance() {
    setOpenAppointmentId(null)
    window.history.replaceState(null, "", "/atendimento")
    loadQueue()
  }

  async function handleStart(item: AttendanceQueueItem) {
    setActionError("")
    try {
      const res = await fetch(`/api/attendance/${item.id}/start`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      })

      if (res.ok) {
        // Sucesso: abre diretamente o cabeçalho do atendimento iniciado.
        openAttendance(item.id)
        await loadQueue()
        return
      }

      const err = await res.json().catch(() => ({}))
      // Já iniciado (por este ou outro usuário): abre o atendimento existente.
      if (err.code === "ALREADY_STARTED" && err.appointmentId) {
        openAttendance(err.appointmentId)
        await loadQueue()
        return
      }
      setActionError(err.error || "Não foi possível iniciar o atendimento.")
      await loadQueue()
    } catch {
      setActionError("Erro de conexão. Tente novamente.")
    }
  }

  const hasItems = items.length > 0

  const summaryCards = useMemo(
    () => [
      {
        key: "released",
        label: "Liberados",
        value: summary.released,
        icon: <ShieldCheck className="h-4 w-4 text-green-600" />,
      },
      {
        key: "awaiting",
        label: "Aguardando atendimento",
        value: summary.awaiting,
        icon: <Clock className="h-4 w-4 text-amber-600" />,
      },
      {
        key: "inProgress",
        label: "Em atendimento",
        value: summary.inProgress,
        icon: <PlayCircle className="h-4 w-4 text-blue-600" />,
      },
      {
        key: "completed",
        label: "Concluídos",
        value: summary.completed,
        icon: <CheckCircle2 className="h-4 w-4 text-gray-500" />,
      },
    ],
    [summary]
  )

  // ---------------------------------------------------------------------------
  // Cabeçalho do paciente (Parte 2): exibido quando há um atendimento aberto.
  // Renderizado após todos os hooks para manter a ordem estável de chamadas.
  // ---------------------------------------------------------------------------
  if (activeAppointmentId) {
    return (
      <div className="space-y-5">
        <PatientHeader
          attendanceId={activeAppointmentId}
          onBack={closeAttendance}
          onAttendanceChanged={loadQueue}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho da tela */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Atendimento</h1>
          <p className="text-sm text-gray-500">Pacientes liberados para atendimento</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-blue-700">
            <CalendarDays className="h-4 w-4" />
            {formatLongDate(dateKey)}
          </p>
        </div>

        {/* Filtro de data */}
        <div className="flex items-end gap-2">
          <div>
            <label
              htmlFor="attendance-date"
              className="mb-1.5 block text-xs font-medium text-gray-600"
            >
              Data do atendimento
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate(-1)}
                title="Dia anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                id="attendance-date"
                type="date"
                value={dateKey}
                onChange={(e) => e.target.value && setDateKey(e.target.value)}
                className="w-[160px]"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate(1)}
                title="Próximo dia"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToToday}>
                Hoje
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Resumo da fila */}
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
            <p className="mt-1 text-xl font-bold text-gray-900">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Busca + filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar paciente por nome ou CPF..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setStatusFilter(filter.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                statusFilter === filter.value
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-200 text-gray-600 hover:bg-gray-100"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {actionError}
          </span>
          <button
            className="text-xs font-medium text-red-700 hover:underline"
            onClick={() => setActionError("")}
          >
            Fechar
          </button>
        </div>
      )}

      {/* Fila de atendimento */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Fila de atendimento
        </h2>

        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-16 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando fila...
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <AlertTriangle className="h-12 w-12 text-red-300" />
              <h3 className="mt-3 text-base font-medium text-gray-900">{error}</h3>
              <Button variant="outline" className="mt-4" onClick={loadQueue}>
                Tentar novamente
              </Button>
            </CardContent>
          </Card>
        ) : !hasItems ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="h-12 w-12 text-gray-300" />
              <h3 className="mt-3 text-base font-medium text-gray-900">
                Nenhum paciente liberado nesta data
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {query.trim() || statusFilter !== "all"
                  ? "Ajuste a busca ou os filtros para ver outros pacientes."
                  : `Não há pacientes liberados para atendimento em ${toBRDate(dateKey)}.`}
              </p>
              <p className="mt-3 max-w-md text-xs text-gray-400">
                Os pacientes aparecem aqui após o pagamento ser confirmado na Agenda.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => (
              <AttendanceQueueRow
                key={item.id}
                item={item}
                onViewPatient={(id) => setSelectedPatientId(id)}
                onContinue={() => openAttendance(item.id)}
                onStart={handleStart}
              />
            ))}
          </div>
        )}
      </div>

      {detailsPatientId && (
        <PatientDetailsPanel
          patientId={detailsPatientId}
          onClose={() => {
            setSelectedPatientId(null)
            onPatientPanelClosed?.()
          }}
          onEdit={(patient) => {
            setSelectedPatientId(null)
            setEditingPatient(patient)
          }}
        />
      )}

      {editingPatient && (
        <PatientFormModal
          initialData={editingPatient}
          onCancel={() => setEditingPatient(null)}
          onSuccess={() => {
            setEditingPatient(null)
            loadQueue()
          }}
        />
      )}
    </div>
  )
}

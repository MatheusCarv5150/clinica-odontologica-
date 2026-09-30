"use client"

import { useCallback, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CalendarRange,
  Calendar,
  Loader2,
  Plus,
  Search,
  AlertTriangle,
  User,
  ClipboardList,
  DollarSign,
  Wallet,
} from "lucide-react"
import {
  STATUS_LABELS,
  STATUS_COLORS,
  formatCurrency,
  getWhatsAppLink,
} from "@/lib/schemas"
import {
  type Appointment,
  type ViewMode,
  ACTIVE_STATUSES,
  TIME_SLOTS,
  formatDateBR,
  getDayName,
  getRange,
  sameDay,
  toDateKey,
} from "./agenda-utils"
import { AppointmentCard } from "./appointment-card"
import { WeekView, MonthView } from "./agenda-period-views"
import { PaymentQuickModal } from "./payment-quick-modal"
import { useAsyncData } from "@/lib/use-async-data"

const ALL_STATUSES = "all"

interface AgendaGridProps {
  onNewAppointment?: (date?: string) => void
  onEditAppointment?: (appointment: Appointment) => void
}

export function AgendaGrid({ onNewAppointment, onEditAppointment }: AgendaGridProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState<ViewMode>("day")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUSES)
  const [searchTerm, setSearchTerm] = useState("")
  const [paymentAppt, setPaymentAppt] = useState<Appointment | null>(null)
  const [actionError, setActionError] = useState("")

  const loadAppointments = useCallback(async () => {
    let url = "/api/appointments"
    if (view === "day") {
      url += `?date=${toDateKey(currentDate)}`
    } else {
      const { start, end } = getRange(currentDate, view)
      url += `?start=${toDateKey(start)}&end=${toDateKey(end)}`
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error("Falha ao carregar agendamentos")
    const payload = await res.json()
    return (Array.isArray(payload) ? payload : []) as Appointment[]
  }, [currentDate, view])

  const {
    data: appointmentsData,
    isLoading,
    reload: reloadAppointments,
  } = useAsyncData<Appointment[]>(loadAppointments, [currentDate, view])

  // Alias sempre-array para os cálculos derivados abaixo. Estável entre
  // renders para não invalidar os useMemo que dependem dele.
  const appointments = useMemo(() => appointmentsData ?? [], [appointmentsData])

  function navigate(direction: -1 | 1) {
    setExpandedId(null)
    if (view === "day") {
      const d = new Date(currentDate)
      d.setDate(d.getDate() + direction)
      setCurrentDate(d)
    } else if (view === "week") {
      const d = new Date(currentDate)
      d.setDate(d.getDate() + direction * 7)
      setCurrentDate(d)
    } else {
      setCurrentDate(
        new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1)
      )
    }
  }

  function goToToday() {
    setCurrentDate(new Date())
    setExpandedId(null)
  }

  async function updateStatus(appt: Appointment, status: string) {
    if (status === "cancelled") {
      if (!confirm(`Cancelar o agendamento de ${appt.patient.fullName}?`)) return
    }
    try {
      const res = await fetch(`/api/appointments/${appt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setExpandedId(null)
        await reloadAppointments()
      } else {
        const err = await res.json().catch(() => ({}))
        setActionError(err.error || "Erro ao atualizar o agendamento.")
      }
    } catch {
      setActionError("Erro de conexão. Tente novamente.")
    }
  }

  function openWhatsApp(appt: Appointment) {
    const baseLink = getWhatsAppLink(appt.patient.phone)
    if (!baseLink) {
      setActionError(`Paciente ${appt.patient.fullName} não possui telefone cadastrado.`)
      return
    }
    const firstName = appt.patient.fullName.split(" ")[0]
    const { start } = getRange(currentDate, "day")
    const dataStr = formatDateBR(start)
    const message = `Olá, ${firstName}! Confirmando sua consulta em ${dataStr} às ${appt.appointmentTime}. Podemos confirmar?`
    const finalLink = getWhatsAppLink(appt.patient.phone, message) || baseLink
    window.open(finalLink, "_blank")
  }

  const filteredAppointments = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const digits = term.replace(/\D/g, "")
    return appointments.filter((a) => {
      if (statusFilter !== ALL_STATUSES && a.status !== statusFilter) return false
      if (term) {
        const nameMatch = a.patient.fullName.toLowerCase().includes(term)
        const cpfMatch = digits.length > 0 && (a.patient.cpf || "").includes(digits)
        if (!nameMatch && !cpfMatch) return false
      }
      return true
    })
  }, [appointments, statusFilter, searchTerm])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of appointments) {
      counts[a.status] = (counts[a.status] || 0) + 1
    }
    return counts
  }, [appointments])

  const summary = useMemo(() => {
    const active = appointments.filter((a) =>
      ACTIVE_STATUSES.includes(a.status as (typeof ACTIVE_STATUSES)[number])
    )
    const uniquePatients = new Set(appointments.map((a) => a.patient.id)).size
    const expectedRevenue = active.reduce((sum, a) => sum + (a.totalAmount || 0), 0)
    const received = appointments.reduce(
      (sum, a) =>
        sum + a.payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0),
      0
    )
    const pending = Math.max(expectedRevenue - received, 0)
    return {
      patients: uniquePatients,
      appointments: active.length,
      expectedRevenue,
      pending,
    }
  }, [appointments])

  const isToday = sameDay(currentDate, new Date())

  const rangeLabel =
    view === "day"
      ? `${getDayName(currentDate)}, ${formatDateBR(currentDate)}`
      : view === "week"
        ? (() => {
            const { start, end } = getRange(currentDate, "week")
            return `${formatDateBR(start)} – ${formatDateBR(end)}`
          })()
        : currentDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} title="Anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday}>
            Hoje
          </Button>
          <Button variant="outline" size="icon" onClick={() => navigate(1)} title="Próximo">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-1 text-sm font-semibold capitalize text-gray-900">
            {rangeLabel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 p-0.5">
            <button
              onClick={() => setView("day")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                view === "day" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Dia
            </button>
            <button
              onClick={() => setView("week")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                view === "week" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <CalendarRange className="h-3.5 w-3.5" />
              Semana
            </button>
            <button
              onClick={() => setView("month")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                view === "month" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              Mês
            </button>
          </div>

          <Button
            size="sm"
            onClick={() => {
              const date = view === "day" ? toDateKey(currentDate) : undefined
              onNewAppointment?.(date)
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Novo agendamento
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={<User className="h-4 w-4 text-blue-600" />}
          label="Pacientes"
          value={String(summary.patients)}
        />
        <SummaryCard
          icon={<ClipboardList className="h-4 w-4 text-indigo-600" />}
          label="Atendimentos"
          value={String(summary.appointments)}
        />
        <SummaryCard
          icon={<DollarSign className="h-4 w-4 text-green-600" />}
          label="Receita prevista"
          value={formatCurrency(summary.expectedRevenue)}
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4 text-amber-600" />}
          label="A receber"
          value={formatCurrency(summary.pending)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por nome ou CPF..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setStatusFilter(ALL_STATUSES)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              statusFilter === ALL_STATUSES
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-200 text-gray-600 hover:bg-gray-100"
            }`}
          >
            Todos ({appointments.length})
          </button>
          {Object.entries(statusCounts).map(([status, count]) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === status
                  ? "border-blue-600 bg-blue-600 text-white"
                  : `${STATUS_COLORS[status]} border-transparent`
              }`}
            >
              {STATUS_LABELS[status] || status} ({count})
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

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando agendamentos...
        </div>
      ) : view === "day" ? (
        <DayView
          appointments={filteredAppointments}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          onEditAppointment={onEditAppointment}
          onPay={setPaymentAppt}
          onWhatsApp={openWhatsApp}
          onCancel={(appt) => updateStatus(appt, "cancelled")}
          isToday={isToday}
        />
      ) : view === "week" ? (
        <WeekView
          appointments={filteredAppointments}
          currentDate={currentDate}
          onEditAppointment={onEditAppointment}
          onAdd={(date) => onNewAppointment?.(date)}
        />
      ) : (
        <MonthView
          appointments={filteredAppointments}
          currentDate={currentDate}
          onEditAppointment={onEditAppointment}
          onAdd={(date) => onNewAppointment?.(date)}
        />
      )}

      {paymentAppt && (
        <PaymentQuickModal
          appointment={paymentAppt}
          onClose={() => setPaymentAppt(null)}
          onSuccess={() => {
            setPaymentAppt(null)
            void reloadAppointments()
          }}
        />
      )}
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
    </div>
  )
}

interface DayViewProps {
  appointments: Appointment[]
  expandedId: string | null
  onToggle: (id: string) => void
  onEditAppointment?: (appointment: Appointment) => void
  onPay: (appointment: Appointment) => void
  onWhatsApp: (appointment: Appointment) => void
  onCancel: (appointment: Appointment) => void
  isToday: boolean
}

function DayView({
  appointments,
  expandedId,
  onToggle,
  onEditAppointment,
  onPay,
  onWhatsApp,
  onCancel,
  isToday,
}: DayViewProps) {
  const bySlot = useMemo(() => {
    const map: Record<string, Appointment[]> = {}
    for (const a of appointments) {
      const slot = a.appointmentTime?.slice(0, 5) || ""
      if (!map[slot]) map[slot] = []
      map[slot].push(a)
    }
    return map
  }, [appointments])

  const hasAny = appointments.length > 0

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {!hasAny && (
        <div className="py-16 text-center text-sm text-gray-400">
          {isToday ? "Nenhum agendamento para hoje." : "Nenhum agendamento nesta data."}
        </div>
      )}

      {TIME_SLOTS.map((slot) => {
        const slotAppts = bySlot[slot] || []
        if (slotAppts.length === 0) return null
        return (
          <div key={slot} className="flex border-b border-gray-100 last:border-b-0">
            <div className="w-16 shrink-0 border-r border-gray-100 px-2 py-3 text-right text-xs font-medium text-gray-400">
              {slot}
            </div>
            <div className="flex-1 space-y-2 p-2">
              {slotAppts.map((appt) => (
                <AppointmentCard
                  key={appt.id}
                  appointment={appt}
                  isOpen={expandedId === appt.id}
                  onToggle={() => onToggle(appt.id)}
                  onEditAppointment={onEditAppointment}
                  onPay={onPay}
                  onWhatsApp={onWhatsApp}
                  onCancel={onCancel}
                />
              ))}
            </div>
          </div>
        )
      })}

      {(() => {
        const offSlot = appointments.filter(
          (a) => !TIME_SLOTS.includes(a.appointmentTime?.slice(0, 5) || "")
        )
        if (offSlot.length === 0) return null
        return (
          <div className="flex border-t border-gray-100">
            <div className="w-16 shrink-0 border-r border-gray-100 px-2 py-3 text-right text-xs font-medium text-gray-400">
              outros
            </div>
            <div className="flex-1 space-y-2 p-2">
              {offSlot.map((appt) => (
                <AppointmentCard
                  key={appt.id}
                  appointment={appt}
                  isOpen={expandedId === appt.id}
                  onToggle={() => onToggle(appt.id)}
                  onEditAppointment={onEditAppointment}
                  onPay={onPay}
                  onWhatsApp={onWhatsApp}
                  onCancel={onCancel}
                />
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

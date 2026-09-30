"use client"

import { Badge } from "@/components/ui/badge"
import { Plus, HeartPulse } from "lucide-react"
import { STATUS_COLORS } from "@/lib/schemas"
import {
  type Appointment,
  WEEKDAY_SHORT,
  addDays,
  appointmentDateKey,
  sameDay,
  startOfWeek,
  toDateKey,
} from "./agenda-utils"

interface PeriodViewProps {
  appointments: Appointment[]
  currentDate: Date
  onEditAppointment?: (appointment: Appointment) => void
  onAdd: (date: string) => void
}

// Card compacto usado na semana/mês
function MiniAppointmentCard({
  appointment: a,
  onEdit,
}: {
  appointment: Appointment
  onEdit?: (appointment: Appointment) => void
}) {
  const hasHealthAlert = !!a.patient.healthNotes?.trim()
  return (
    <button
      type="button"
      onClick={() => onEdit?.(a)}
      title={a.patient.fullName + (hasHealthAlert ? ` — ${a.patient.healthNotes}` : "")}
      className="flex w-full flex-col gap-0.5 rounded-md border border-gray-100 bg-white p-1.5 text-left hover:shadow-sm transition-shadow"
    >
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-semibold text-gray-500 shrink-0">
          {a.appointmentTime}
        </span>
        {hasHealthAlert && <HeartPulse className="h-3 w-3 shrink-0 text-amber-600" />}
        <span className="truncate text-[11px] text-gray-800">{a.patient.fullName}</span>
      </div>
      <Badge className={`${STATUS_COLORS[a.status]} w-fit text-[9px] px-1 py-0`}>
        {a.status === "cancelled"
          ? "Cancelado"
          : a.status === "no_show"
            ? "Não compareceu"
            : a.status === "completed"
              ? "Concluído"
              : a.status === "paid"
                ? "Pago"
                : a.status === "awaiting_payment"
                  ? "A pagar"
                  : a.status === "in_progress"
                    ? "Em atendimento"
                    : a.status === "awaiting_attendance"
                      ? "Aguardando"
                      : "Agendado"}
      </Badge>
    </button>
  )
}

export function WeekView({
  appointments,
  currentDate,
  onEditAppointment,
  onAdd,
}: PeriodViewProps) {
  const start = startOfWeek(currentDate)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const today = new Date()

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
      {days.map((day) => {
        const key = toDateKey(day)
        const dayAppts = appointments
          .filter((a) => appointmentDateKey(a) === key)
          .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime))
        const isToday = sameDay(day, today)

        return (
          <div
            key={key}
            className={`flex min-h-[140px] flex-col rounded-lg border p-2 ${
              isToday ? "border-blue-300 bg-blue-50/40" : "border-gray-200 bg-white"
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-baseline gap-1">
                <span
                  className={`text-xs font-semibold ${isToday ? "text-blue-700" : "text-gray-500"}`}
                >
                  {WEEKDAY_SHORT[day.getDay()]}
                </span>
                <span
                  className={`text-sm font-bold ${isToday ? "text-blue-700" : "text-gray-900"}`}
                >
                  {day.getDate()}
                </span>
              </div>
              <span className="text-[10px] text-gray-400">{dayAppts.length}</span>
            </div>

            <div className="flex-1 space-y-1">
              {dayAppts.map((a) => (
                <MiniAppointmentCard key={a.id} appointment={a} onEdit={onEditAppointment} />
              ))}
            </div>

            <button
              className="mt-1 flex items-center justify-center rounded-md border border-dashed border-gray-200 py-1 text-[11px] text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
              onClick={() => onAdd(key)}
            >
              <Plus className="h-3 w-3 mr-0.5" />
              Agendar
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function MonthView({
  appointments,
  currentDate,
  onEditAppointment,
  onAdd,
}: PeriodViewProps) {
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const firstOfMonth = new Date(year, month, 1)
  const gridStart = startOfWeek(firstOfMonth)
  // 6 semanas cobrindo o mês
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const today = new Date()

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      {/* Cabeçalho dos dias da semana */}
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {WEEKDAY_SHORT.map((d) => (
          <div
            key={d}
            className="px-2 py-1.5 text-center text-xs font-semibold text-gray-500"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Células dos dias */}
      <div className="grid grid-cols-7">
        {cells.map((day) => {
          const key = toDateKey(day)
          const isCurrentMonth = day.getMonth() === month
          const isToday = sameDay(day, today)
          const dayAppts = appointments
            .filter((a) => appointmentDateKey(a) === key)
            .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime))
          const hasHealthAlert = dayAppts.some((a) => !!a.patient.healthNotes?.trim())
          const MAX_VISIBLE = 3
          const extra = dayAppts.length - MAX_VISIBLE

          return (
            <div
              key={key}
              className={`min-h-[110px] border-b border-r border-gray-100 p-1.5 ${
                isCurrentMonth ? "bg-white" : "bg-gray-50/60"
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    isToday
                      ? "bg-blue-600 text-white"
                      : isCurrentMonth
                        ? "text-gray-700"
                        : "text-gray-400"
                  }`}
                >
                  {day.getDate()}
                </span>
                <div className="flex items-center gap-1">
                  {hasHealthAlert && <HeartPulse className="h-3 w-3 text-amber-600" />}
                  {dayAppts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onAdd(key)}
                      className="text-[10px] text-gray-400 hover:text-blue-500"
                      title="Adicionar agendamento"
                    >
                      +{dayAppts.length}
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                {dayAppts.slice(0, MAX_VISIBLE).map((a) => (
                  <MiniAppointmentCard
                    key={a.id}
                    appointment={a}
                    onEdit={onEditAppointment}
                  />
                ))}
                {extra > 0 && (
                  <p className="pl-1 text-[10px] text-gray-400">+ {extra} mais</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

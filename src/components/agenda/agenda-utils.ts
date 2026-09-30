// Utilitários de data e helpers compartilhados da agenda

export interface Appointment {
  id: string
  appointmentDate: string
  appointmentTime: string
  status: string
  totalAmount: number | null
  patient: {
    id: string
    fullName: string
    cpf: string
    phone?: string | null
    healthNotes?: string | null
  }
  procedures: Array<{
    id: string
    procedureNameSnapshot: string
    totalPrice: number
  }>
  payments: Array<{
    id: string
    amount: number
    status: string
    paymentMethod?: string
  }>
}

export type ViewMode = "day" | "week" | "month"

// Status usados no filtro rápido (ordem de exibição)
export const FILTER_STATUSES = [
  "scheduled",
  "awaiting_payment",
  "paid",
  "awaiting_attendance",
  "in_progress",
  "completed",
  "no_show",
  "cancelled",
] as const

// Status que representam um atendimento "ativo" no período
export const ACTIVE_STATUSES = FILTER_STATUSES.filter(
  (s) => s !== "cancelled" && s !== "no_show"
)

export const TIME_SLOTS = [
  "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
  "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00",
]

export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

const WEEKDAY_LONG = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
]

export function formatDateBR(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleDateString("pt-BR")
}

export function getDayName(date: Date): string {
  return WEEKDAY_LONG[date.getDay()]
}

// Converte um Date para string YYYY-MM-DD no horário LOCAL
// (evita o deslocamento de fuso do toISOString)
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

// Chave de data de um agendamento
export function appointmentDateKey(appt: Appointment): string {
  const raw = appt.appointmentDate
  if (typeof raw === "string") {
    if (raw.includes("T")) return raw.split("T")[0]
    return raw
  }
  return toDateKey(new Date(raw))
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  )
}

// Intervalo (start, end) coberto pela view atual
export function getRange(currentDate: Date, view: ViewMode): { start: Date; end: Date } {
  if (view === "day") {
    return { start: currentDate, end: currentDate }
  }
  if (view === "week") {
    const start = startOfWeek(currentDate)
    return { start, end: addDays(start, 6) }
  }
  const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
  return { start, end }
}

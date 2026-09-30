import { formatCPF, formatPhone } from "@/lib/schemas"

// Reexportados para uso pelos componentes da tela de Atendimento
export { formatCPF, formatPhone }

export interface AttendanceQueueItem {
  id: string
  appointmentTime: string | null
  status: string
  patient: {
    id: string
    fullName: string
    cpf: string
    phone: string | null
    age: number | null
    hasHealthAlert: boolean
  }
  procedures: Array<{
    id: string
    name: string
    quantity: number
  }>
}

export interface AttendanceSummary {
  released: number
  awaiting: number
  inProgress: number
  completed: number
}

// Data por extenso no padrão: "Hoje, 10 de setembro de 2026"
export function formatLongDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  if (!y || !m || !d) return dateKey
  const date = new Date(y, m - 1, d)
  const formatted = date.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  const now = new Date()
  const isToday =
    now.getFullYear() === y && now.getMonth() === m - 1 && now.getDate() === d
  return isToday ? `Hoje, ${formatted}` : formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

// "YYYY-MM-DD" a partir de um Date local
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

// "DD/MM/YYYY" a partir de "YYYY-MM-DD"
export function toBRDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-")
  if (!y || !m || !d) return dateKey
  return `${d}/${m}/${y}`
}

export function formatAge(age: number | null): string {
  if (age === null) return "Idade não informada"
  return `${age} ${age === 1 ? "ano" : "anos"}`
}

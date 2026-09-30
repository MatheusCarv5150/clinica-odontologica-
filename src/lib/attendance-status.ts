// Domínio compartilhado do módulo Atendimento (RSC-safe).
//
// Centraliza rótulos visuais, identificador amigável e o formato de exibição
// do atendimento. Evita que cada componente recrie suas próprias tabelas de
// status e mantém a identidade visual única do sistema.

// Rótulo operacional exibido no fluxo de atendimento.
// Observação: "paid" é apresentado como "Aguardando atendimento" na visão da
// fila (diferente do rótulo financeiro usado na Agenda).
export const ATTENDANCE_STATUS_META: Record<
  string,
  { label: string; badge: string; dot: string; accent: string }
> = {
  paid: {
    label: "Aguardando atendimento",
    badge: "bg-green-100 text-green-800",
    dot: "bg-green-500",
    accent: "border-l-green-500",
  },
  awaiting_attendance: {
    label: "Aguardando atendimento",
    badge: "bg-green-100 text-green-800",
    dot: "bg-green-500",
    accent: "border-l-green-500",
  },
  in_progress: {
    label: "Em atendimento",
    badge: "bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
    accent: "border-l-blue-500",
  },
  completed: {
    label: "Concluído",
    badge: "bg-gray-100 text-gray-700",
    dot: "bg-gray-400",
    accent: "border-l-gray-300",
  },
}

export function getAttendanceStatusMeta(status: string) {
  return ATTENDANCE_STATUS_META[status] ?? ATTENDANCE_STATUS_META.completed
}

// Gera um identificador amigável e estável a partir do registro real.
// Não é um novo dado persistido — é apenas uma apresentação legível do id.
export function buildFriendlyCode(id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
  return compact.slice(-6).padStart(6, "0")
}

// "10/09/2026 às 08:30" — data/horário do atendimento em formato clínico.
export function formatAttendanceDateTime(
  date: Date | string,
  time: string | null
): string {
  const d = typeof date === "string" ? new Date(date) : date
  const datePart = d.toLocaleDateString("pt-BR", { timeZone: "UTC" })
  return time ? `${datePart} às ${time}` : datePart
}

// Duração em minutos entre o início do atendimento e o momento atual/referência.
export function formatElapsedMinutes(
  startedAt: Date | string,
  reference: Date = new Date()
): string | null {
  const start = typeof startedAt === "string" ? new Date(startedAt) : startedAt
  if (Number.isNaN(start.getTime())) return null
  const minutes = Math.floor((reference.getTime() - start.getTime()) / 60000)
  if (minutes < 0 || minutes > 24 * 60) return null
  if (minutes < 1) return "menos de 1 min"
  return `${minutes} min`
}

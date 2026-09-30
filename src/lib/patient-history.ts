// Domínio compartilhado do HISTÓRICO DO PACIENTE (módulo Atendimento — Parte 3).
//
// Centraliza os tipos do contrato com a API e as regras de apresentação do
// histórico, para que backend e frontend falem a mesma língua sem duplicar
// tabelas de status nem formatar datas de formas divergentes.
//
// Princípios respeitados nesta camada:
// - Paciente e Atendimento são entidades distintas: o histórico é uma lista
//   de ATENDIMENTOS (appointments), nunca um único campo concatenado.
// - O nome e o valor do procedimento vêm do SNAPSHOT gravado no atendimento
//   (AppointmentProcedure.procedureNameSnapshot / unitPrice). O catálogo
//   atual de procedures nunca é usado para reconstruir o passado.
// - Nenhum dado clínico sensível é derivado aqui: apenas o que o backend
//   autoriza é exibido.

// ---------------------------------------------------------------------------
// Tipos do contrato (GET /api/attendance/[id]/history)
// ---------------------------------------------------------------------------

export interface PatientHistoryProcedure {
  id: string
  // Nome preservado no momento do atendimento (snapshot), não o nome atual.
  name: string
  quantity: number
}

export interface PatientHistoryItem {
  id: string
  date: string
  time: string | null
  status: string
  isCurrent: boolean
  procedures: PatientHistoryProcedure[]
  // Profissional responsável quando a relação existir na arquitetura.
  professional: { id: string; name: string } | null
  // Observação do atendimento (registro pontual daquele atendimento).
  notes: string | null
  // Evolução clínica do atendimento, quando essa estrutura existir.
  evolution: string | null
}

// Resumo do histórico de um paciente.
export interface PatientHistorySummary {
  total: number
  completed: number
  lastVisit: string | null
}

export interface PatientHistoryResponse {
  patient: {
    id: string
    fullName: string
  }
  current: PatientHistoryItem | null
  items: PatientHistoryItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasMore: boolean
  }
  summary: PatientHistorySummary
}

// ---------------------------------------------------------------------------
// Metadados de status específicos do histórico
// ---------------------------------------------------------------------------

// O histórico exibe o status REAL de cada atendimento. Diferente da fila (que
// só mostra a operação do dia), aqui precisamos distinguir claramente o que
// foi realizado, cancelado ou não comparecido. Reutilizamos os rótulos
// oficiais do sistema (STATUS_LABELS em schemas.ts) e apenas acrescentamos o
// ponto/acento visual usado na linha do tempo clínica.
export interface HistoryStatusMeta {
  label: string
  badge: string
  dot: string
  // Um atendimento que não gerou procedimento real (cancelado/não compareceu
  // / aguardando) não deve ser lido como "realizado".
  performed: boolean
}

const HISTORY_STATUS_META: Record<string, HistoryStatusMeta> = {
  scheduled: {
    label: "Agendado",
    badge: "bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
    performed: false,
  },
  awaiting_payment: {
    label: "Aguardando pagamento",
    badge: "bg-yellow-100 text-yellow-800",
    dot: "bg-yellow-500",
    performed: false,
  },
  paid: {
    label: "Liberado",
    badge: "bg-green-100 text-green-800",
    dot: "bg-green-500",
    performed: false,
  },
  awaiting_attendance: {
    label: "Aguardando atendimento",
    badge: "bg-green-100 text-green-800",
    dot: "bg-green-500",
    performed: false,
  },
  in_progress: {
    label: "Em atendimento",
    badge: "bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
    performed: false,
  },
  completed: {
    label: "Concluído",
    badge: "bg-gray-100 text-gray-700",
    dot: "bg-gray-400",
    performed: true,
  },
  cancelled: {
    label: "Cancelado",
    badge: "bg-red-100 text-red-800",
    dot: "bg-red-500",
    performed: false,
  },
  no_show: {
    label: "Não compareceu",
    badge: "bg-orange-100 text-orange-800",
    dot: "bg-orange-500",
    performed: false,
  },
}

export function getHistoryStatusMeta(status: string): HistoryStatusMeta {
  return (
    HISTORY_STATUS_META[status] ?? {
      label: status,
      badge: "bg-gray-100 text-gray-700",
      dot: "bg-gray-400",
      performed: false,
    }
  )
}

// ---------------------------------------------------------------------------
// Apresentação
// ---------------------------------------------------------------------------

// "15/08/2026" — data de um atendimento. As datas da agenda são persistidas
// em UTC à meia-noite; formatamos em UTC para não deslocar o dia conforme o
// fuso do navegador.
export function formatHistoryDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" })
}

// "15/08/2026 • 14:30" — data e horário de um atendimento.
export function formatHistoryDateTime(
  date: Date | string,
  time: string | null
): string {
  const datePart = formatHistoryDate(date)
  return time ? `${datePart} • ${time}` : datePart
}

// Resumo curto de uma observação/evolução longa, sem cortar no meio de uma
// palavra. Devolve também se houve corte, para o chamador oferecer "Ver mais".
export function truncateText(
  text: string,
  maxLength = 160
): { text: string; truncated: boolean } {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) {
    return { text: normalized, truncated: false }
  }
  const slice = normalized.slice(0, maxLength)
  const lastSpace = slice.lastIndexOf(" ")
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice
  return { text: `${cut}…`, truncated: true }
}

// Lista compacta de procedimentos: "Avaliação • Limpeza • +2".
// Mantém a ordem REAL registrada no atendimento (não reordena nem deduplica).
export function summarizeProcedures(
  procedures: PatientHistoryProcedure[],
  visibleLimit = 3
): { text: string; hiddenCount: number } {
  if (procedures.length === 0) return { text: "", hiddenCount: 0 }
  const labels = procedures.map((p) =>
    p.quantity > 1 ? `${p.name} ×${p.quantity}` : p.name
  )
  const visible = labels.slice(0, visibleLimit)
  const hiddenCount = Math.max(0, labels.length - visibleLimit)
  const text = hiddenCount > 0 ? `${visible.join(" • ")} • +${hiddenCount}` : visible.join(" • ")
  return { text, hiddenCount }
}

// Data por extenso para o cabeçalho do histórico: "10 de setembro de 2026".
export function formatHistoryLongDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

import { z } from "zod"

// Validação de CPF
function isValidCPF(cpf: string): boolean {
  const cleaned = cpf.replace(/\D/g, "")
  if (cleaned.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cleaned)) return false

  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned.charAt(i)) * (10 - i)
  }
  let remainder = (sum * 10) % 11
  if (remainder === 10) remainder = 0
  if (remainder !== parseInt(cleaned.charAt(9))) return false

  sum = 0
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned.charAt(i)) * (11 - i)
  }
  remainder = (sum * 10) % 11
  if (remainder === 10) remainder = 0
  if (remainder !== parseInt(cleaned.charAt(10))) return false

  return true
}

// Schema de paciente
export const patientSchema = z.object({
  fullName: z.string().min(3, "Nome deve ter no mínimo 3 caracteres"),
  cpf: z.string().refine((val) => isValidCPF(val), "CPF inválido"),
  phone: z
    .string()
    .optional()
    .refine(
      (val) => !val || val.replace(/\D/g, "").length >= 10,
      "Telefone inválido (inclua DDD)"
    ),
  birthDate: z.string().refine((val) => {
    const date = new Date(val)
    return !isNaN(date.getTime()) && date < new Date()
  }, "Data de nascimento inválida"),
  healthNotes: z.string().default(""),
})

export type PatientInput = z.infer<typeof patientSchema>

// Schema de procedimento no agendamento
export const appointmentProcedureSchema = z.object({
  procedureId: z.string().min(1, "Procedimento é obrigatório"),
  procedureName: z.string().min(1, "Nome do procedimento é obrigatório"),
  unitPrice: z.number().min(0, "Valor deve ser maior ou igual a zero"),
  quantity: z.number().int().min(1, "Quantidade deve ser no mínimo 1"),
})

export type AppointmentProcedureInput = z.infer<typeof appointmentProcedureSchema>

// Schema de pagamento
export const paymentSchema = z.object({
  amount: z.number().min(0, "Valor deve ser maior ou igual a zero"),
  paymentMethod: z.string().min(1, "Forma de pagamento é obrigatória"),
  isPaid: z.boolean().default(false),
})

export type PaymentInput = z.infer<typeof paymentSchema>

// Schema completo de agendamento
export const appointmentSchema = z.object({
  patientId: z.string().min(1, "Paciente é obrigatório"),
  appointmentDate: z.string().min(1, "Data é obrigatória"),
  appointmentTime: z.string().min(1, "Horário é obrigatório"),
  procedures: z.array(appointmentProcedureSchema).min(1, "Selecione pelo menos um procedimento"),
  payment: paymentSchema,
})

export type AppointmentInput = z.infer<typeof appointmentSchema>

// Schema de busca
export const patientSearchSchema = z.object({
  query: z.string().min(1, "Digite pelo menos um caractere para buscar"),
})

// Status do agendamento
export const AppointmentStatus = {
  SCHEDULED: "scheduled",
  AWAITING_PAYMENT: "awaiting_payment",
  PAID: "paid",
  AWAITING_ATTENDANCE: "awaiting_attendance",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
} as const

export type AppointmentStatusType = (typeof AppointmentStatus)[keyof typeof AppointmentStatus]

// Status do pagamento
export const PaymentStatus = {
  PENDING: "pending",
  PAID: "paid",
  REFUNDED: "refunded",
} as const

export type PaymentStatusType = (typeof PaymentStatus)[keyof typeof PaymentStatus]

// Formas de pagamento
export const PAYMENT_METHODS = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "PIX" },
  { value: "cartao_debito", label: "Cartão de Débito" },
  { value: "cartao_credito", label: "Cartão de Crédito" },
  { value: "transferencia", label: "Transferência" },
  { value: "outros", label: "Outros" },
] as const

// Procedimentos padrão (serão substituídos pelo módulo de Procedimentos futuramente)
export const DEFAULT_PROCEDURES = [
  { name: "Avaliação odontológica", defaultPrice: 100 },
  { name: "Limpeza", defaultPrice: 150 },
  { name: "Restauração", defaultPrice: 250 },
  { name: "Clareamento", defaultPrice: 500 },
  { name: "Extração", defaultPrice: 200 },
  { name: "Radiografia", defaultPrice: 80 },
  { name: "Canal", defaultPrice: 400 },
  { name: "Prótese", defaultPrice: 600 },
  { name: "Implante", defaultPrice: 1500 },
  { name: "Aparelho ortodôntico", defaultPrice: 0 },
] as const

// Schema de procedimento
export const procedureSchema = z.object({
  name: z.string().min(1, "Nome do procedimento é obrigatório"),
  category: z.string().min(1, "Categoria é obrigatória"),
  code: z.string().min(1, "Código interno é obrigatório"),
  defaultPrice: z.number().min(0, "Valor deve ser maior ou igual a zero"),
  allowPriceOverride: z.boolean().default(true),
  description: z.string().default(""),
  active: z.boolean().default(true),
})

export type ProcedureInput = z.infer<typeof procedureSchema>

// Schema de procedimento para edição
export const procedureUpdateSchema = z.object({
  name: z.string().min(1, "Nome do procedimento é obrigatório"),
  category: z.string().min(1, "Categoria é obrigatória"),
  code: z.string().min(1, "Código interno é obrigatório"),
  defaultPrice: z.number().min(0, "Valor deve ser maior ou igual a zero"),
  allowPriceOverride: z.boolean(),
  description: z.string().default(""),
  active: z.boolean(),
})

export type ProcedureUpdateInput = z.infer<typeof procedureUpdateSchema>

// Categorias de procedimentos
export const PROCEDURE_CATEGORIES = [
  "Consulta / Avaliação",
  "Prevenção",
  "Restauração",
  "Cirurgia",
  "Estética",
  "Ortodontia",
  "Radiologia",
  "Prótese",
  "Endodontia",
  "Periodontia",
  "Outros",
] as const

export type ProcedureCategory = (typeof PROCEDURE_CATEGORIES)[number]

/** Verifica se uma string arbitrária é uma categoria de procedimento válida. */
export function isProcedureCategory(
  value: string
): value is ProcedureCategory {
  return (PROCEDURE_CATEGORIES as readonly string[]).includes(value)
}

// Função para formatar CPF
export function formatCPF(value: string): string {
  const cleaned = value.replace(/\D/g, "").slice(0, 11)
  if (cleaned.length <= 3) return cleaned
  if (cleaned.length <= 6) return `${cleaned.slice(0, 3)}.${cleaned.slice(3)}`
  if (cleaned.length <= 9) return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6)}`
  return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9)}`
}

// Função para formatar moeda
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

// Função para formatar data
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleDateString("pt-BR")
}

// Função para formatar data e hora
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleString("pt-BR")
}

// Função para formatar telefone brasileiro
export function formatPhone(value: string | null | undefined): string {
  if (!value) return ""
  const cleaned = value.replace(/\D/g, "").slice(0, 11)
  if (cleaned.length <= 2) return cleaned
  if (cleaned.length <= 6) return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2)}`
  if (cleaned.length <= 10)
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 6)}-${cleaned.slice(6)}`
  return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`
}

// Monta um link do WhatsApp a partir de um telefone brasileiro.
// Prefixa o DDI 55 quando ausente. Retorna null se o telefone for inválido.
export function getWhatsAppLink(
  phone: string | null | undefined,
  message?: string
): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 10) return null
  const withCountry = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`
  const base = `https://wa.me/${withCountry}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}

// Labels dos status
export const STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendado",
  awaiting_payment: "Aguardando pagamento",
  paid: "Pago / Liberado",
  awaiting_attendance: "Aguardando atendimento",
  in_progress: "Em atendimento",
  completed: "Concluído",
  cancelled: "Cancelado",
  no_show: "Não compareceu",
}

// Cores dos status
export const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  awaiting_payment: "bg-yellow-100 text-yellow-800",
  paid: "bg-green-100 text-green-800",
  awaiting_attendance: "bg-indigo-100 text-indigo-800",
  in_progress: "bg-purple-100 text-purple-800",
  completed: "bg-gray-100 text-gray-800",
  cancelled: "bg-red-100 text-red-800",
  no_show: "bg-orange-100 text-orange-800",
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  paid: "Pago",
  refunded: "Estornado",
}

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  paid: "bg-green-100 text-green-800",
  refunded: "bg-red-100 text-red-800",
}

// ---------------------------------------------------------------------------
// Módulo Atendimento
// ---------------------------------------------------------------------------
// A fila de atendimento é uma visão operacional dos agendamentos já
// existentes. O paciente é considerado "liberado" quando o status do
// agendamento indica que o pagamento foi resolvido (pago) ou quando o
// próprio profissional já o moveu para a fila (aguardando atendimento).

// Status a partir dos quais é permitido iniciar o atendimento.
// Cancelado, não compareceu, apenas agendado e aguardando pagamento
// NÃO podem iniciar atendimento.
export const STARTABLE_STATUSES = ["paid", "awaiting_attendance"] as const

// Status que compõem a fila exibida na tela de Atendimento.
// Cancelado e não compareceu ficam de fora.
export const ATTENDANCE_QUEUE_STATUSES = [
  "paid",
  "awaiting_attendance",
  "in_progress",
  "completed",
] as const

// Verifica se um status permite iniciar o atendimento
export function canStartAttendance(status: string): boolean {
  return (STARTABLE_STATUSES as readonly string[]).includes(status)
}
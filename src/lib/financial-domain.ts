// ===========================================================================
// DOMÍNIO FINANCEIRO — módulo Financeiro (Parte 11 — Financeiro 1).
// ===========================================================================
//
// Fonte da verdade das REGRAS financeiras. Backend e frontend leem daqui:
// nenhum total é calculado na tela, e nenhum conceito de valor é misturado.
//
// PRINCÍPIO ARQUITETURAL — SEPARAÇÃO DE CONCEITOS
//
// O Financeiro trabalha com naturezas DIFERENTES de valor. Elas nunca são
// somadas entre si nem reduzidas a um único campo:
//
//   PREVISTO    -> o que foi planejado/contratado (total_amount, total_price)
//   COBRADO     -> o que foi efetivamente apresentado ao paciente
//   RECEBIDO    -> dinheiro que efetivamente entrou (payments status=paid)
//   PENDENTE    -> o que é devido e ainda não entrou
//   CANCELADO   -> o que foi anulado (não entra em nenhum total)
//   ESTORNADO   -> o que entrou e foi devolvido (revertido)
//
// NÃO AUTENTICAÇÃO
//
// Este módulo não trata identidade como segurança. `professionalName` e
// equivalentes são ATRIBUIÇÃO textual (quem fez), não autenticação. Não existe
// login/sessão/RBAC nesta fase (decisão 3-A), e este módulo não simula isso.
//
// Este arquivo NÃO acessa banco: ele é puro e testável isoladamente.

// ---------------------------------------------------------------------------
// Direção da movimentação
// ---------------------------------------------------------------------------

export const TRANSACTION_DIRECTIONS = ["in", "out"] as const
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number]

export const DIRECTION_LABELS: Record<string, string> = {
  in: "Entrada",
  out: "Saída",
}

// ---------------------------------------------------------------------------
// Status da movimentação financeira
// ---------------------------------------------------------------------------
// Distinto do status do PAGAMENTO e do status da DESPESA — são conceitos
// diferentes em camadas diferentes.

export const TRANSACTION_STATUSES = [
  "pending",
  "settled",
  "cancelled",
  "reversed",
] as const
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number]

export const TRANSACTION_STATUS_LABELS: Record<string, string> = {
  pending: "Previsto",
  settled: "Efetivado",
  cancelled: "Cancelado",
  reversed: "Estornado",
}

export const TRANSACTION_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  settled: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-600",
  reversed: "bg-red-100 text-red-800",
}

// Status que REPRESENTAM dinheiro efetivamente movimentado no caixa.
// `cancelled` e `reversed` NÃO contam como caixa realizado.
export function isCashEffective(status: string): boolean {
  return status === "settled"
}

// Status que NÃO entram em nenhum total (nem previsto, nem realizado).
export function isExcludedFromTotals(status: string): boolean {
  return status === "cancelled" || status === "reversed"
}

// Status que compõem a projeção (previsto + efetivado).
export function isProjectable(status: string): boolean {
  return !isExcludedFromTotals(status)
}

// ---------------------------------------------------------------------------
// Formas de pagamento
// ---------------------------------------------------------------------------
// Mesmo vocabulário de `payments.payment_method`. O Financeiro NÃO inventa um
// segundo vocabulário: rótulos ausentes caem para o próprio código.

export const FINANCIAL_PAYMENT_METHOD_LABELS: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Cartão de Débito",
  cartao_credito: "Cartão de Crédito",
  transferencia: "Transferência",
  outros: "Outros",
}

export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "Não informado"
  return FINANCIAL_PAYMENT_METHOD_LABELS[method] ?? method
}

// ---------------------------------------------------------------------------
// Natureza da despesa (categoria)
// ---------------------------------------------------------------------------

export const EXPENSE_KINDS = [
  "operacional",
  "pessoal",
  "material",
  "infraestrutura",
  "impostos",
  "marketing",
  "outros",
] as const
export type ExpenseKind = (typeof EXPENSE_KINDS)[number]

export const EXPENSE_KIND_LABELS: Record<string, string> = {
  operacional: "Operacional",
  pessoal: "Pessoal",
  material: "Material",
  infraestrutura: "Infraestrutura",
  impostos: "Impostos",
  marketing: "Marketing",
  outros: "Outros",
}

export function isExpenseKind(value: string): value is ExpenseKind {
  return (EXPENSE_KINDS as readonly string[]).includes(value)
}

// Status da DESPESA (compromisso), distinto do status da movimentação.
// "pending"  -> em aberto, ainda não paga
// "partial"  -> parcialmente paga
// "paid"     -> totalmente quitada
// "cancelled"-> cancelada (não entra em nenhum total)
export const EXPENSE_STATUSES = ["pending", "partial", "paid", "cancelled"] as const
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number]

export const EXPENSE_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  partial: "Parcial",
  paid: "Paga",
  cancelled: "Cancelada",
}

export const EXPENSE_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  partial: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-600",
}

// ---------------------------------------------------------------------------
// Convênios
// ---------------------------------------------------------------------------

export const INSURANCE_PLAN_KINDS = [
  "particular",
  "convenio",
  "plano_odontologico",
] as const
export type InsurancePlanKind = (typeof INSURANCE_PLAN_KINDS)[number]

export const INSURANCE_PLAN_KIND_LABELS: Record<string, string> = {
  particular: "Particular",
  convenio: "Convênio",
  plano_odontologico: "Plano odontológico",
}

export function isInsurancePlanKind(value: string): value is InsurancePlanKind {
  return (INSURANCE_PLAN_KINDS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Valores — normalização e arredondamento
// ---------------------------------------------------------------------------
// Valores monetários são tratados em CENTAVOS para evitar erro de ponto
// flutuante em somas (0.1 + 0.2 !== 0.3). A conversão acontece na borda de
// apresentação, nunca no meio de um cálculo.

/** Arredonda um valor monetário para 2 casas decimais de forma estável. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Converte reais para centavos inteiros (sem erro de float). */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

/** Converte centavos inteiros de volta para reais. */
export function fromCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0
  return cents / 100
}

/** Soma uma lista de valores monetários de forma segura (via centavos). */
export function sumMoney(values: readonly number[]): number {
  let cents = 0
  for (const v of values) cents += toCents(v)
  return fromCents(cents)
}

/**
 * Normaliza um valor monetário vindo do cliente/entrada.
 *
 * NÃO usa `Math.abs`: um valor negativo é um erro de entrada, não um valor a
 * ser "corrigido" para positivo. O sinal é preservado para que a validação a
 * montante rejeite o lançamento — nunca convertemos -50 em 50 silenciosamente.
 */
export function normalizeAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return roundMoney(n)
}

// ---------------------------------------------------------------------------
// Agregação de movimentações
// ---------------------------------------------------------------------------

export interface TransactionLike {
  direction: string
  amount: number
  status: string
}

export interface FlowTotals {
  // Entradas efetivadas (dinheiro que entrou de fato).
  received: number
  // Saídas efetivadas (dinheiro que saiu de fato).
  paid: number
  // Resultado do caixa: received - paid.
  net: number
  // Entradas previstas (ainda não efetivadas) — não confundir com recebidas.
  expectedIn: number
  // Saídas previstas (ainda não efetivadas).
  expectedOut: number
  // Resultado projetado: (received + expectedIn) - (paid + expectedOut).
  projectedNet: number
  // Contadores (úteis para o Dashboard sem consulta extra).
  settledCount: number
  pendingCount: number
}

/**
 * Consolida uma lista de movimentações em totais SEPARADOS por natureza.
 * Canceladas e estornadas são ignoradas em todos os totais.
 */
export function aggregateFlow(transactions: readonly TransactionLike[]): FlowTotals {
  let received = 0
  let paid = 0
  let expectedIn = 0
  let expectedOut = 0
  let settledCount = 0
  let pendingCount = 0

  for (const t of transactions) {
    if (isExcludedFromTotals(t.status)) continue
    const amount = toCents(t.amount)

    if (isCashEffective(t.status)) {
      settledCount++
      if (t.direction === "in") received += amount
      else if (t.direction === "out") paid += amount
      continue
    }

    // status previsto/pendente
    pendingCount++
    if (t.direction === "in") expectedIn += amount
    else if (t.direction === "out") expectedOut += amount
  }

  const receivedR = fromCents(received)
  const paidR = fromCents(paid)
  return {
    received: receivedR,
    paid: paidR,
    net: fromCents(received - paid),
    expectedIn: fromCents(expectedIn),
    expectedOut: fromCents(expectedOut),
    projectedNet: fromCents(received + expectedIn - paid - expectedOut),
    settledCount,
    pendingCount,
  }
}

// ---------------------------------------------------------------------------
// Valores PREVISTOS do atendimento (não são receita)
// ---------------------------------------------------------------------------
// O valor previsto de um atendimento é derivado dos procedimentos agendados
// (`appointment_procedures.total_price`). O `appointments.total_amount` é o
// valor consolidado do atendimento. Ambos são PREVISÃO — nunca receita.

export interface AppointmentValueSnapshot {
  totalAmount: number | null
  proceduresTotal: number
  paidTotal: number
}

export interface AppointmentValues {
  // Valor previsto considerado (total_amount quando informado, senão a soma).
  expected: number
  // Soma dos procedimentos agendados (referência de cálculo).
  proceduresTotal: number
  // `total_amount` explícito do atendimento (pode ser null).
  declaredTotal: number | null
  // Recebido de fato.
  received: number
  // Pendente = previsto - recebido, nunca negativo (pagamento excedente é
  // exposto separadamente para não distorcer o total de pendências).
  pending: number
  // Excedente = recebido além do previsto (sinalizado, não somado a pendente).
  overpaid: number
  // Diferença entre total_amount declarado e soma dos procedimentos.
  // Presente apenas quando ambos existem e divergem — sinaliza inconsistência.
  declaredVsProceduresDiff: number | null
}

export function computeAppointmentValues(
  snapshot: AppointmentValueSnapshot
): AppointmentValues {
  const proceduresTotal = toCents(snapshot.proceduresTotal)
  const declared =
    snapshot.totalAmount == null ? null : toCents(snapshot.totalAmount)
  const received = toCents(snapshot.paidTotal)

  // Previsão: o total declarado tem precedência; a soma é o fallback.
  const expected = declared ?? proceduresTotal

  const pending = Math.max(expected - received, 0)
  const overpaid = Math.max(received - expected, 0)

  const declaredVsProceduresDiff =
    declared != null && declared !== proceduresTotal
      ? fromCents(declared - proceduresTotal)
      : null

  return {
    expected: fromCents(expected),
    proceduresTotal: fromCents(proceduresTotal),
    declaredTotal: declared == null ? null : fromCents(declared),
    received: fromCents(received),
    pending: fromCents(pending),
    overpaid: fromCents(overpaid),
    declaredVsProceduresDiff,
  }
}

// ---------------------------------------------------------------------------
// Períodos do Dashboard
// ---------------------------------------------------------------------------

export const PERIOD_PRESETS = ["today", "7d", "30d", "month", "year", "custom"] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

export const PERIOD_LABELS: Record<string, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Este mês",
  year: "Este ano",
  custom: "Período personalizado",
}

export interface DateRange {
  start: Date
  end: Date
}

/**
 * Resolve o intervalo [start, end] de um preset.
 * `reference` permite testes determinísticos.
 *
 * Usa o fuso LOCAL do servidor (mesma convenção de `date-utils.ts`), e limita
 * o fim ao último milissegundo do dia escolhido.
 */
export function resolvePeriodRange(
  preset: string,
  reference: Date = new Date(),
  custom?: { from?: string; to?: string }
): DateRange {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const endOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

  if (preset === "today") {
    return { start: startOfDay(reference), end: endOfDay(reference) }
  }

  if (preset === "7d" || preset === "30d") {
    // Janela INCLUSIVA: "7d" cobre o dia de referência + 6 anteriores.
    const days = preset === "7d" ? 7 : 30
    const end = endOfDay(reference)
    const start = startOfDay(reference)
    start.setDate(start.getDate() - (days - 1))
    return { start, end }
  }

  if (preset === "month") {
    const start = new Date(reference.getFullYear(), reference.getMonth(), 1, 0, 0, 0, 0)
    const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0, 23, 59, 59, 999)
    return { start, end }
  }

  if (preset === "year") {
    const start = new Date(reference.getFullYear(), 0, 1, 0, 0, 0, 0)
    const end = new Date(reference.getFullYear(), 11, 31, 23, 59, 59, 999)
    return { start, end }
  }

  if (preset === "custom") {
    const parse = (value: string | undefined, fallback: Date) => {
      if (!value) return fallback
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
      if (!m) return fallback
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      return Number.isNaN(d.getTime()) ? fallback : d
    }
    const from = parse(custom?.from, startOfDay(reference))
    const to = parse(custom?.to, reference)
    // Intervalo invertido é normalizado (nunca devolve range inválido).
    const [a, b] = from <= to ? [from, to] : [to, from]
    return { start: startOfDay(a), end: endOfDay(b) }
  }

  // Preset desconhecido: cai para "este mês" (comportamento previsível).
  return resolvePeriodRange("month", reference)
}

/** Chave "YYYY-MM" para agrupar movimentações por mês. */
export function toMonthKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

/** Chave "YYYY-MM-DD" no fuso local. */
export function toDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Rótulo curto "MM/YYYY" a partir de uma chave de mês. */
export function monthKeyLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m) return key
  return `${m[2]}/${m[1]}`
}

// ---------------------------------------------------------------------------
// Consolidação dos pagamentos existentes em movimentações de receita
// ---------------------------------------------------------------------------
// DERIVAÇÃO, NÃO DUPLICAÇÃO: cada pagamento gera NO MÁXIMO uma movimentação de
// receita, identificada por `paymentId`. Esta função apenas descreve como o
// pagamento se projeta no fluxo — ela não persiste nada.

export interface PaymentLike {
  id: string
  amount: number
  status: string
  paidAt: Date | null
  createdAt: Date
  paymentMethod: string
  appointmentId: string
}

export interface DerivedIncome {
  // Status da movimentação derivada (não do pagamento).
  status: TransactionStatus
  // Data de competência/efetivação.
  competenceDate: Date
}

/**
 * Deriva o estado da movimentação de receita a partir do PAGAMENTO de origem.
 *
 *   pagamento "paid"     -> movimentação "settled" (entrou de fato)
 *   pagamento "pending"  -> movimentação "pending" (previsto)
 *   pagamento "refunded" -> movimentação "reversed" (estornado)
 */
export function deriveIncomeFromPayment(payment: PaymentLike): DerivedIncome {
  if (payment.status === "paid") {
    return {
      status: "settled",
      competenceDate: payment.paidAt ?? payment.createdAt,
    }
  }
  if (payment.status === "refunded") {
    return {
      status: "reversed",
      competenceDate: payment.paidAt ?? payment.createdAt,
    }
  }
  return { status: "pending", competenceDate: payment.createdAt }
}

// ---------------------------------------------------------------------------
// Contas a receber (PREVISÃO, não receita)
// ---------------------------------------------------------------------------
// Um atendimento gera expectativa de recebimento quando tem valor previsto.
// Isto NÃO é receita: é previsão. A distinção evita inflar o "recebido".
// Cancelado e não compareceu NÃO geram conta a receber.

export const NON_BILLABLE_STATUSES = ["cancelled", "no_show"] as const

export function isBillableAppointmentStatus(status: string): boolean {
  return !(NON_BILLABLE_STATUSES as readonly string[]).includes(status)
}

/** Rótulo de forma de pagamento segura para exibição (nunca inventa dado). */
export function safeText(value: string | null | undefined, fallback = "—"): string {
  const trimmed = (value ?? "").trim()
  return trimmed.length > 0 ? trimmed : fallback
}

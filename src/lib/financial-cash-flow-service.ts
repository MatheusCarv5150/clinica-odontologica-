// ===========================================================================
// SERVIÇO DE FLUXO DE CAIXA — módulo Financeiro (Financeiro 5).
// ===========================================================================
//
// O QUE ESTE SERVIÇO É
//
// A visão CONSOLIDADA das movimentações financeiras que EFETIVAMENTE
// aconteceram no caixa da clínica, com filtros, busca, ordenação, paginação,
// agrupamento por dia, saldo do período e saldo acumulado — tudo no SERVIDOR.
//
// ---------------------------------------------------------------------------
// REGRA MAIS IMPORTANTE: NÃO CRIAR UMA SEGUNDA FONTE DE VERDADE
// ---------------------------------------------------------------------------
//
// Este serviço NÃO persiste NENHUMA tabela. Ele não cria `CashMovement`. Ele
// apenas LÊ as fontes de verdade já existentes e PROJETA ambas numa estrutura
// comum (`CashFlowItem`) que existe somente na camada de aplicação/API.
//
//   ENTRADA  -> `payments`         (pagamento do paciente, status "paid")
//   SAÍDA    -> `expense_payments` (pagamento EFETIVO da despesa)
//
// Por que ler as FONTES (payments / expense_payments) e não a projeção
// `financial_transactions`?
//
// A `financial_transactions` (Financeiro 1) é uma projeção de caixa útil ao
// Dashboard, mas a projeção de DESPESA consolida todos os pagamentos de uma
// despesa em UMA linha (amount = total pago). O Fluxo de Caixa exige a
// granularidade de cada pagamento individual (pagamentos parciais e múltiplos
// — regras 18 e 19 do módulo). As fontes de verdade preservam essa
// granularidade; a projeção de despesa, não.
//
//   payments         -> 1 linha por pagamento recebido
//   expense_payments -> 1 linha por pagamento efetuado
//
// Assim, o Fluxo de Caixa NUNCA duplica: ele deriva. Cada item carrega o
// identificador da origem (`paymentId` / `expensePaymentId`) para rastreio e
// para abrir o detalhe/origem.
//
// ---------------------------------------------------------------------------
// DIFERENÇA ENTRE SALDO DO PERÍODO E SALDO ACUMULADO
// ---------------------------------------------------------------------------
//   * saldo do período = entradas do período - saídas do período
//   * saldo acumulado  = entradas/saídas HISTÓRICAS (anteriores + período)
//
// Como não existe saldo inicial cadastrado, o saldo acumulado é a soma das
// movimentações registradas no sistema (histórico conhecido). Isso é
// explicitado no payload (`balanceNote`) para que a UI nunca afirme que se
// trata do saldo bancário real.
//
// ---------------------------------------------------------------------------
// CANCELAMENTO E ESTORNO
// ---------------------------------------------------------------------------
//   * pagamento de paciente "refunded" -> item "reversed" (fora do saldo;
//     preserva o registro original no histórico).
//   * pagamento de paciente "pending"  -> NÃO entra no caixa realizado.
//   * despesa cancelada                -> seus pagamentos NÃO entram no caixa.
//   * despesa parcialmente paga        -> entram apenas os pagamentos
//     EFETIVOS (o saldo em aberto é assunto do módulo de Despesas).
//
// Nada é apagado: o histórico é preservado e representado corretamente.

import { prisma } from "@/lib/prisma"
import {
  fromCents,
  paymentMethodLabel,
  resolvePeriodRange,
  roundMoney,
  toCents,
  toDayKey,
  type DateRange,
  type TransactionStatus,
} from "@/lib/financial-domain"

// ---------------------------------------------------------------------------
// Tipos públicos (contrato consumido pela API e pela tela)
// ---------------------------------------------------------------------------

/** Tipo de movimentação de caixa. */
export const CASH_FLOW_TYPES = ["INCOME", "EXPENSE"] as const
export type CashFlowType = (typeof CASH_FLOW_TYPES)[number]

/** Origem da movimentação (fonte de verdade, nunca texto livre). */
export const CASH_FLOW_SOURCES = ["PAYMENT", "EXPENSE_PAYMENT"] as const
export type CashFlowSource = (typeof CASH_FLOW_SOURCES)[number]

export const CASH_FLOW_TYPE_LABELS: Record<CashFlowType, string> = {
  INCOME: "Entrada",
  EXPENSE: "Saída",
}

export const CASH_FLOW_SOURCE_LABELS: Record<CashFlowSource, string> = {
  PAYMENT: "Pagamento de paciente",
  EXPENSE_PAYMENT: "Pagamento de despesa",
}

/**
 * Status da movimentação de caixa.
 *   "settled"  -> dinheiro efetivamente movimentado
 *   "reversed" -> movimentação estornada (preservada, fora do saldo)
 *   "pending"  -> NÃO usada como caixa realizado; existe para completude do
 *                 tipo (o caixa só projeta o efetivo).
 */
export type CashFlowStatus = Extract<TransactionStatus, "settled" | "reversed" | "pending">

export interface CashFlowProcedure {
  name: string
  quantity: number
  totalPrice: number
}

/** Um item consolidado do fluxo de caixa (NÃO persistido). */
export interface CashFlowItem {
  /** Identificador da LINHA no fluxo (prefixado pela origem, estável). */
  id: string
  type: CashFlowType
  typeLabel: string
  source: CashFlowSource
  sourceLabel: string

  /** Data efetiva da movimentação (recebimento / pagamento). */
  date: string
  /** Chave "YYYY-MM-DD" no fuso local (agrupamento por dia). */
  dayKey: string

  /** Valor POSITIVO. O sinal vem de `type`, nunca do valor. */
  amount: number
  /** Status apresentável do item. */
  status: CashFlowStatus

  description: string

  // --- Contexto de ENTRADA ---
  paymentId: string | null
  appointmentId: string | null
  appointmentCode: string | null
  patientId: string | null
  patientName: string | null
  professionalName: string | null
  procedures: CashFlowProcedure[]

  // --- Contexto de SAÍDA ---
  expenseId: string | null
  expensePaymentId: string | null
  supplier: string | null
  categoryId: string | null
  categoryName: string | null
  categoryKind: string | null

  // --- Comum ---
  paymentMethod: string | null
  paymentMethodLabel: string
  /** Saldo acumulado APÓS esta movimentação (ordem cronológica). */
  runningBalance: number

  // --- Estorno ---
  reversedAt: string | null
  reverseReason: string | null
  reversedByName: string | null
}

/** Totais do período, sempre SEPARADOS por natureza. */
export interface CashFlowTotals {
  /** Total efetivamente recebido no período. */
  totalIncome: number
  /** Total efetivamente pago no período. */
  totalExpense: number
  /** Saldo do período = entradas - saídas. */
  periodBalance: number
  /** Nº de movimentações de entrada. */
  incomeCount: number
  /** Nº de movimentações de saída. */
  expenseCount: number
  /** Saldo das movimentações ANTERIORES ao período (histórico conhecido). */
  openingBalance: number
  /** Saldo acumulado ao FINAL do período. */
  closingBalance: number
}

export interface CashFlowDailyGroup {
  dayKey: string
  /** "YYYY-MM-DD" para exibição. */
  date: string
  income: number
  expense: number
  /** Saldo do dia = entradas - saídas. */
  net: number
  incomeCount: number
  expenseCount: number
}

export interface CashFlowSeriesPoint {
  key: string
  label: string
  income: number
  expense: number
  net: number
}

export interface CashFlowMethodSlice {
  method: string
  label: string
  amount: number
  count: number
  sharePercent: number
}

export interface CashFlowCategorySlice {
  categoryId: string
  name: string
  kind: string
  amount: number
  count: number
  sharePercent: number
}

export interface ListCashFlowOptions {
  period?: string
  from?: string
  to?: string
  /** "ALL" | "INCOME" | "EXPENSE" */
  type?: string
  paymentMethod?: string
  categoryId?: string
  source?: string
  patientId?: string
  supplier?: string
  professionalName?: string
  search?: string
  sort?: "date" | "amount"
  direction?: "asc" | "desc"
  page?: number
  pageSize?: number
}

export interface ListCashFlowResult {
  /** Movimentações da página atual. */
  movements: CashFlowItem[]
  /** Agrupamento por dia (do conjunto filtrado COMPLETO). */
  daily: CashFlowDailyGroup[]
  /** Série do gráfico (do conjunto filtrado completo). */
  series: {
    granularity: "day" | "month"
    points: CashFlowSeriesPoint[]
  }
  /** Formas de pagamento presentes (só valores REAIS). */
  byMethod: CashFlowMethodSlice[]
  /** Categorias de saída presentes (só valores REAIS). */
  byCategory: CashFlowCategorySlice[]
  totals: CashFlowTotals
  pagination: {
    page: number
    pageSize: number
    totalPages: number
    totalCount: number
    hasPrevious: boolean
    hasNext: boolean
    from: number
    to: number
  }
  period: {
    preset: string
    from: string
    to: string
  }
  /** Transparência sobre a origem do saldo acumulado. */
  balanceNote: {
    /** "registered_movements" quando não há saldo inicial cadastrado. */
    openingBalanceSource: "registered_movements"
    message: string
  }
  meta: {
    movementsConsidered: number
    generatedAt: string
  }
}

export interface CashFlowDetail extends CashFlowItem {
  /** Histórico dos pagamentos da mesma origem (rastreabilidade). */
  relatedPayments: {
    id: string
    amount: number
    paymentMethod: string
    paymentMethodLabel: string
    paidAt: string
    isCurrent: boolean
  }[]
  /** Contexto adicional da origem. */
  originContext: {
    expectedTotal: number | null
    receivedTotal: number | null
    pendingTotal: number | null
    appointmentDate: string | null
    appointmentTime: string | null
    appointmentStatus: string | null
    expenseAmount: number | null
    expenseBalance: number | null
    expenseStatus: string | null
    expenseDueDate: string | null
    documentNumber: string | null
    notes: string | null
  }
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_SERIES_POINTS = 62
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Rótulo curto "DD/MM" para o eixo do gráfico. */
function dayKeyShortLabel(key: string): string {
  const m = DAY_KEY_RE.exec(key)
  return m ? `${m[3]}/${m[2]}` : key
}

/** Chave "YYYY-MM" no fuso local (granularidade mensal da série). */
function toMonthKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** Código curto do atendimento (mesma convenção do serviço de Receitas). */
function appointmentCode(id: string | null): string | null {
  if (!id) return null
  return id.slice(-8).toUpperCase()
}

/**
 * Uma movimentação de caixa "crua", antes de receber saldo acumulado.
 * `sortTime` é o instante usado para ordenação cronológica.
 */
interface RawMovement {
  item: Omit<CashFlowItem, "runningBalance">
  sortTime: number
}

// ---------------------------------------------------------------------------
// LEITURA DAS ENTRADAS (fonte: `payments`)
// ---------------------------------------------------------------------------
// Um pagamento só entra no caixa quando o dinheiro foi RECEBIDO (status
// "paid"). Pagamento "refunded" é estornado (preservado, fora do saldo).
// Pagamento "pending" não é caixa realizado.
//
// Na fase atual o schema usa "refunded" como reversão — mapeada para "reversed".

async function loadIncomeMovements(
  range: DateRange,
  filter: { paymentMethod?: string }
): Promise<RawMovement[]> {
  const payments = await prisma.payment.findMany({
    where: {
      status: { in: ["paid", "refunded"] },
      ...(filter.paymentMethod ? { paymentMethod: filter.paymentMethod } : {}),
      OR: [
        { paidAt: { gte: range.start, lte: range.end } },
        // Um pagamento revertido pode não ter paidAt; usa createdAt.
        { paidAt: null, createdAt: { gte: range.start, lte: range.end } },
      ],
    },
    select: {
      id: true,
      amount: true,
      status: true,
      paidAt: true,
      createdAt: true,
      paymentMethod: true,
      appointmentId: true,
      appointment: {
        select: {
          id: true,
          patientId: true,
          finishedByName: true,
          patient: { select: { id: true, fullName: true } },
          procedures: {
            select: { procedureNameSnapshot: true, quantity: true, totalPrice: true },
          },
        },
      },
    },
    orderBy: { paidAt: "asc" },
  })

  return payments.map((p) => {
    const effectiveDate = p.paidAt ?? p.createdAt
    const status: CashFlowStatus = p.status === "refunded" ? "reversed" : "settled"
    const appt = p.appointment
    const patientName = appt?.patient?.fullName ?? null

    const procedures: CashFlowProcedure[] = (appt?.procedures ?? []).map((proc) => ({
      name: proc.procedureNameSnapshot,
      quantity: proc.quantity,
      totalPrice: roundMoney(proc.totalPrice),
    }))

    return {
      sortTime: effectiveDate.getTime(),
      item: {
        id: `income:${p.id}`,
        type: "INCOME" as const,
        typeLabel: CASH_FLOW_TYPE_LABELS.INCOME,
        source: "PAYMENT" as const,
        sourceLabel: CASH_FLOW_SOURCE_LABELS.PAYMENT,
        date: effectiveDate.toISOString(),
        dayKey: toDayKey(effectiveDate),
        amount: roundMoney(p.amount),
        status,
        description: patientName
          ? `Pagamento — ${patientName}`
          : `Recebimento — ${paymentMethodLabel(p.paymentMethod)}`,
        paymentId: p.id,
        appointmentId: p.appointmentId,
        appointmentCode: appointmentCode(p.appointmentId),
        patientId: appt?.patientId ?? null,
        patientName,
        professionalName: appt?.finishedByName ?? null,
        procedures,
        expenseId: null,
        expensePaymentId: null,
        supplier: null,
        categoryId: null,
        categoryName: null,
        categoryKind: null,
        paymentMethod: p.paymentMethod,
        paymentMethodLabel: paymentMethodLabel(p.paymentMethod),
        reversedAt: status === "reversed" ? effectiveDate.toISOString() : null,
        reverseReason: null,
        reversedByName: null,
      },
    }
  })
}

// ---------------------------------------------------------------------------
// LEITURA DAS SAÍDAS (fonte: `expense_payments`)
// ---------------------------------------------------------------------------
// Uma saída existe quando a despesa foi EFETIVAMENTE PAGA. Cada pagamento
// (parcial ou total) é uma movimentação individual — preserva rastreabilidade.
// Despesa CANCELADA não gera saída (compromisso anulado).

async function loadExpenseMovements(
  range: DateRange,
  filter: { paymentMethod?: string; categoryId?: string }
): Promise<RawMovement[]> {
  const payments = await prisma.expensePayment.findMany({
    where: {
      paidAt: { gte: range.start, lte: range.end },
      ...(filter.paymentMethod ? { paymentMethod: filter.paymentMethod } : {}),
      expense: {
        status: { not: "cancelled" },
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      },
    },
    select: {
      id: true,
      amount: true,
      paymentMethod: true,
      paidAt: true,
      expense: {
        select: {
          id: true,
          description: true,
          supplier: true,
          categoryId: true,
          category: { select: { id: true, name: true, kind: true } },
        },
      },
    },
    orderBy: { paidAt: "asc" },
  })

  return payments.map((ep) => {
    const expense = ep.expense
    return {
      sortTime: ep.paidAt.getTime(),
      item: {
        id: `expense:${ep.id}`,
        type: "EXPENSE" as const,
        typeLabel: CASH_FLOW_TYPE_LABELS.EXPENSE,
        source: "EXPENSE_PAYMENT" as const,
        sourceLabel: CASH_FLOW_SOURCE_LABELS.EXPENSE_PAYMENT,
        date: ep.paidAt.toISOString(),
        dayKey: toDayKey(ep.paidAt),
        amount: roundMoney(ep.amount),
        status: "settled" as const,
        description: expense.description,
        paymentId: null,
        appointmentId: null,
        appointmentCode: null,
        patientId: null,
        patientName: null,
        professionalName: null,
        procedures: [],
        expenseId: expense.id,
        expensePaymentId: ep.id,
        supplier: expense.supplier,
        categoryId: expense.category?.id ?? expense.categoryId,
        categoryName: expense.category?.name ?? null,
        categoryKind: expense.category?.kind ?? null,
        paymentMethod: ep.paymentMethod,
        paymentMethodLabel: paymentMethodLabel(ep.paymentMethod),
        reversedAt: null,
        reverseReason: null,
        reversedByName: null,
      },
    }
  })
}

// ---------------------------------------------------------------------------
// SALDO ACUMULADO (histórico conhecido)
// ---------------------------------------------------------------------------

/**
 * Soma líquida das movimentações ANTERIORES ao início do período.
 *
 * Não existe saldo inicial cadastrado: o "saldo de abertura" é o resultado das
 * movimentações registradas no sistema até `before`.
 */
async function computeOpeningBalance(before: Date): Promise<number> {
  const [incomeAgg, expenseAgg] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: "paid", paidAt: { lt: before } },
      _sum: { amount: true },
    }),
    prisma.expensePayment.aggregate({
      where: { paidAt: { lt: before }, expense: { status: { not: "cancelled" } } },
      _sum: { amount: true },
    }),
  ])

  const incomeCents = toCents(incomeAgg._sum.amount ?? 0)
  const expenseCents = toCents(expenseAgg._sum.amount ?? 0)
  return fromCents(incomeCents - expenseCents)
}

// ---------------------------------------------------------------------------
// FILTROS EM MEMÓRIA (origem / paciente / fornecedor / busca)
// ---------------------------------------------------------------------------
// O filtro grosso roda no banco (período, método, categoria). Os predicados
// que dependem de contexto denormalizado (busca textual ampla, profissional,
// fornecedor) refinam o conjunto já restrito ao período — nunca carregam a
// base inteira.

function applyInMemoryFilters(
  movements: RawMovement[],
  options: ListCashFlowOptions
): RawMovement[] {
  const search = options.search?.trim().toLowerCase() ?? ""
  const supplier = options.supplier?.trim().toLowerCase() ?? ""
  const professional = options.professionalName?.trim().toLowerCase() ?? ""

  return movements.filter(({ item }) => {
    if (options.type === "INCOME" && item.type !== "INCOME") return false
    if (options.type === "EXPENSE" && item.type !== "EXPENSE") return false
    if (options.source && item.source !== options.source) return false
    if (options.patientId && item.patientId !== options.patientId) return false

    if (supplier) {
      if (item.type !== "EXPENSE") return false
      if (!(item.supplier ?? "").toLowerCase().includes(supplier)) return false
    }

    if (professional) {
      if (item.type !== "INCOME") return false
      if (!(item.professionalName ?? "").toLowerCase().includes(professional)) return false
    }

    if (search) {
      const haystack = [
        item.description,
        item.patientName,
        item.supplier,
        item.categoryName,
        item.paymentMethodLabel,
        item.appointmentCode,
        item.appointmentId,
        item.expenseId,
        item.paymentId,
        ...item.procedures.map((p) => p.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      if (!haystack.includes(search)) return false
    }

    return true
  })
}

// ---------------------------------------------------------------------------
// SALDO ACUMULADO POR ITEM
// ---------------------------------------------------------------------------

/**
 * Atribui o saldo acumulado a cada item, em ordem CRONOLÓGICA CRESCENTE.
 * Devolve o mapa id -> saldo acumulado após o item. Estornos não alteram o
 * saldo (fora do realizado), mas continuam no histórico com o saldo corrente.
 */
function computeRunningBalances(
  ascending: RawMovement[],
  openingBalance: number
): Map<string, number> {
  const map = new Map<string, number>()
  let cents = toCents(openingBalance)
  for (const m of ascending) {
    if (m.item.status === "settled") {
      const c = toCents(m.item.amount)
      cents += m.item.type === "INCOME" ? c : -c
    }
    map.set(m.item.id, fromCents(cents))
  }
  return map
}

// ---------------------------------------------------------------------------
// AGRUPAMENTO POR DIA
// ---------------------------------------------------------------------------

function buildDailyGroups(movements: RawMovement[]): CashFlowDailyGroup[] {
  const map = new Map<
    string,
    { incomeCents: number; expenseCents: number; incomeCount: number; expenseCount: number }
  >()

  for (const { item } of movements) {
    if (item.status !== "settled") continue
    const bucket =
      map.get(item.dayKey) ??
      { incomeCents: 0, expenseCents: 0, incomeCount: 0, expenseCount: 0 }
    const cents = toCents(item.amount)
    if (item.type === "INCOME") {
      bucket.incomeCents += cents
      bucket.incomeCount++
    } else {
      bucket.expenseCents += cents
      bucket.expenseCount++
    }
    map.set(item.dayKey, bucket)
  }

  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // decrescente (mais recente primeiro)
    .map(([dayKey, b]) => ({
      dayKey,
      date: dayKey,
      income: fromCents(b.incomeCents),
      expense: fromCents(b.expenseCents),
      net: fromCents(b.incomeCents - b.expenseCents),
      incomeCount: b.incomeCount,
      expenseCount: b.expenseCount,
    }))
}

// ---------------------------------------------------------------------------
// SÉRIE DO GRÁFICO
// ---------------------------------------------------------------------------

function buildSeries(
  range: DateRange,
  movements: RawMovement[]
): { granularity: "day" | "month"; points: CashFlowSeriesPoint[] } {
  const spanDays = Math.ceil((range.end.getTime() - range.start.getTime()) / MS_PER_DAY)
  const granularity: "day" | "month" = spanDays > MAX_SERIES_POINTS ? "month" : "day"

  const map = new Map<string, { incomeCents: number; expenseCents: number }>()

  if (granularity === "day") {
    const cursor = new Date(
      range.start.getFullYear(),
      range.start.getMonth(),
      range.start.getDate()
    )
    const last = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate())
    let guard = 0
    while (cursor <= last && guard < 400) {
      map.set(toDayKey(cursor), { incomeCents: 0, expenseCents: 0 })
      cursor.setDate(cursor.getDate() + 1)
      guard++
    }
  } else {
    const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1)
    const last = new Date(range.end.getFullYear(), range.end.getMonth(), 1)
    let guard = 0
    while (cursor <= last && guard < 120) {
      map.set(toMonthKeyLocal(cursor), { incomeCents: 0, expenseCents: 0 })
      cursor.setMonth(cursor.getMonth() + 1)
      guard++
    }
  }

  for (const { item } of movements) {
    if (item.status !== "settled") continue
    const key =
      granularity === "day" ? item.dayKey : toMonthKeyLocal(new Date(item.date))
    const bucket = map.get(key)
    if (!bucket) continue
    const cents = toCents(item.amount)
    if (item.type === "INCOME") bucket.incomeCents += cents
    else bucket.expenseCents += cents
  }

  const points: CashFlowSeriesPoint[] = [...map.entries()].map(([key, b]) => ({
    key,
    label:
      granularity === "day" ? dayKeyShortLabel(key) : `${key.slice(5)}/${key.slice(0, 4)}`,
    income: fromCents(b.incomeCents),
    expense: fromCents(b.expenseCents),
    net: fromCents(b.incomeCents - b.expenseCents),
  }))

  return { granularity, points }
}

// ---------------------------------------------------------------------------
// QUEBRAS POR MÉTODO E CATEGORIA
// ---------------------------------------------------------------------------

function buildByMethod(movements: RawMovement[]): CashFlowMethodSlice[] {
  const map = new Map<string, { cents: number; count: number }>()
  let total = 0
  for (const { item } of movements) {
    if (item.status !== "settled") continue
    const method = item.paymentMethod ?? "nao_informado"
    const b = map.get(method) ?? { cents: 0, count: 0 }
    const c = toCents(item.amount)
    b.cents += c
    b.count++
    total += c
    map.set(method, b)
  }
  return [...map.entries()]
    .sort((a, b) => b[1].cents - a[1].cents)
    .map(([method, b]) => ({
      method,
      label: method === "nao_informado" ? "Não informado" : paymentMethodLabel(method),
      amount: fromCents(b.cents),
      count: b.count,
      sharePercent: total > 0 ? roundMoney((b.cents / total) * 100) : 0,
    }))
}

function buildByCategory(movements: RawMovement[]): CashFlowCategorySlice[] {
  const map = new Map<string, { name: string; kind: string; cents: number; count: number }>()
  let total = 0
  for (const { item } of movements) {
    if (item.type !== "EXPENSE" || item.status !== "settled") continue
    const key = item.categoryId ?? "sem_categoria"
    const b = map.get(key) ?? {
      name: item.categoryName ?? "Sem categoria",
      kind: item.categoryKind ?? "outros",
      cents: 0,
      count: 0,
    }
    const c = toCents(item.amount)
    b.cents += c
    b.count++
    total += c
    map.set(key, b)
  }
  return [...map.entries()]
    .sort((a, b) => b[1].cents - a[1].cents)
    .map(([categoryId, b]) => ({
      categoryId,
      name: b.name,
      kind: b.kind,
      amount: fromCents(b.cents),
      count: b.count,
      sharePercent: total > 0 ? roundMoney((b.cents / total) * 100) : 0,
    }))
}

// ---------------------------------------------------------------------------
// FUNÇÃO PRINCIPAL
// ---------------------------------------------------------------------------

/**
 * Lista o fluxo de caixa de um período.
 *
 * Deriva as movimentações das fontes de verdade (`payments` e
 * `expense_payments`), consolida numa estrutura comum e calcula saldo do
 * período e saldo acumulado. NÃO persiste nada.
 */
export async function listCashFlow(
  options: ListCashFlowOptions = {}
): Promise<ListCashFlowResult> {
  const preset = options.period ?? "month"
  const { start, end } = resolvePeriodRange(preset, new Date(), {
    from: options.from,
    to: options.to,
  })

  // 1) Leitura das duas fontes de verdade (filtros grossos no banco).
  const [income, expense] = await Promise.all([
    loadIncomeMovements({ start, end }, { paymentMethod: options.paymentMethod }),
    loadExpenseMovements(
      { start, end },
      { paymentMethod: options.paymentMethod, categoryId: options.categoryId }
    ),
  ])

  // 2) Filtros finos (memória) sobre o conjunto já restrito ao período.
  const filtered = applyInMemoryFilters([...income, ...expense], options)

  // 3) Ordenação cronológica crescente (base do saldo acumulado).
  const ascending = [...filtered].sort((a, b) => a.sortTime - b.sortTime)

  // 4) Saldo acumulado (histórico anterior ao período).
  const openingBalance = await computeOpeningBalance(start)
  const runningMap = computeRunningBalances(ascending, openingBalance)
  const withBalance: CashFlowItem[] = ascending.map(({ item }) => ({
    ...item,
    runningBalance: runningMap.get(item.id) ?? roundMoney(openingBalance),
  }))

  // 5) Totais (entradas, saídas, saldo do período e saldo acumulado final).
  let incomeCents = 0
  let expenseCents = 0
  let incomeCount = 0
  let expenseCount = 0
  let runningCents = toCents(openingBalance)
  for (const item of withBalance) {
    if (item.status !== "settled") continue
    const c = toCents(item.amount)
    if (item.type === "INCOME") {
      incomeCents += c
      incomeCount++
      runningCents += c
    } else {
      expenseCents += c
      expenseCount++
      runningCents -= c
    }
  }

  const totals: CashFlowTotals = {
    totalIncome: fromCents(incomeCents),
    totalExpense: fromCents(expenseCents),
    periodBalance: fromCents(incomeCents - expenseCents),
    incomeCount,
    expenseCount,
    openingBalance: roundMoney(openingBalance),
    closingBalance: fromCents(runningCents),
  }

  // 6) Derivados (sobre o conjunto filtrado COMPLETO).
  const daily = buildDailyGroups(filtered)
  const series = buildSeries({ start, end }, filtered)
  const byMethod = buildByMethod(filtered)
  const byCategory = buildByCategory(filtered)

  // 7) Ordenação de exibição + paginação.
  const sort = options.sort ?? "date"
  const direction = options.direction ?? "desc"
  const factor = direction === "asc" ? 1 : -1
  const ordered = [...withBalance].sort((a, b) => {
    if (sort === "amount") return (toCents(a.amount) - toCents(b.amount)) * factor
    return (Date.parse(a.date) - Date.parse(b.date)) * factor
  })

  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100)
  const totalCount = ordered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const page = Math.min(Math.max(options.page ?? 1, 1), totalPages)
  const skip = (page - 1) * pageSize
  const movements = ordered.slice(skip, skip + pageSize)

  return {
    movements,
    daily,
    series,
    byMethod,
    byCategory,
    totals,
    pagination: {
      page,
      pageSize,
      totalPages,
      totalCount,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
      from: totalCount === 0 ? 0 : skip + 1,
      to: Math.min(skip + pageSize, totalCount),
    },
    period: {
      preset,
      from: start.toISOString(),
      to: end.toISOString(),
    },
    balanceNote: {
      openingBalanceSource: "registered_movements",
      message: "Saldo baseado nas movimentações registradas no sistema.",
    },
    meta: {
      movementsConsidered: filtered.length,
      generatedAt: new Date().toISOString(),
    },
  }
}

// ---------------------------------------------------------------------------
// DETALHE DE UMA MOVIMENTAÇÃO
// ---------------------------------------------------------------------------
// Reconstrói UMA movimentação a partir do seu id de fluxo
// ("income:<paymentId>" | "expense:<expensePaymentId>") e anexa o contexto da
// origem (atendimento ou despesa) + o histórico de pagamentos da mesma origem.
// Nada é persistido: tudo é derivado das fontes de verdade.

export async function getCashFlowDetail(
  movementId: string
): Promise<CashFlowDetail | null> {
  const [kind, rawId] = splitMovementId(movementId)
  if (!kind || !rawId) return null

  if (kind === "INCOME") {
    return buildIncomeDetail(rawId)
  }
  return buildExpenseDetail(rawId)
}

function splitMovementId(id: string): [CashFlowType | null, string | null] {
  const sep = id.indexOf(":")
  if (sep < 0) return [null, null]
  const prefix = id.slice(0, sep)
  const raw = id.slice(sep + 1)
  if (!raw) return [null, null]
  if (prefix === "income") return ["INCOME", raw]
  if (prefix === "expense") return ["EXPENSE", raw]
  return [null, null]
}

/** Detalhe de uma ENTRADA (origem: `payments`). */
async function buildIncomeDetail(paymentId: string): Promise<CashFlowDetail | null> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      amount: true,
      status: true,
      paidAt: true,
      createdAt: true,
      paymentMethod: true,
      appointmentId: true,
      appointment: {
        select: {
          id: true,
          patientId: true,
          status: true,
          appointmentDate: true,
          appointmentTime: true,
          totalAmount: true,
          finishedByName: true,
          patient: { select: { id: true, fullName: true } },
          procedures: {
            select: { procedureNameSnapshot: true, quantity: true, totalPrice: true },
          },
          payments: {
            select: {
              id: true,
              amount: true,
              status: true,
              paymentMethod: true,
              paidAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  })
  if (!payment) return null

  const effectiveDate = payment.paidAt ?? payment.createdAt
  const status: CashFlowStatus = payment.status === "refunded" ? "reversed" : "settled"
  const appt = payment.appointment
  const patientName = appt?.patient?.fullName ?? null

  const procedures: CashFlowProcedure[] = (appt?.procedures ?? []).map((proc) => ({
    name: proc.procedureNameSnapshot,
    quantity: proc.quantity,
    totalPrice: roundMoney(proc.totalPrice),
  }))

  // Saldo acumulado do item: como o detalhe é pontual, recalculamos o saldo
  // acumulado ATÉ esta movimentação (histórico conhecido anterior + esta).
  const opening = await computeOpeningBalance(effectiveDate)
  // Soma das outras movimentações do mesmo instante não é somada para não
  // distorcer: o saldo apresentado é o acumulado do dia até este item.
  const runningBalance = roundMoney(opening + (status === "settled" ? payment.amount : 0))

  const paidPayments = (appt?.payments ?? []).filter(
    (p) => p.status === "paid" || p.status === "refunded"
  )
  const receivedTotal = paidPayments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0)
  const proceduresTotal = procedures.reduce((s, p) => s + p.totalPrice, 0)
  const expectedTotal = appt?.totalAmount ?? proceduresTotal
  const pendingTotal = Math.max(roundMoney(expectedTotal - receivedTotal), 0)

  const relatedPayments = paidPayments.map((p) => ({
    id: p.id,
    amount: roundMoney(p.amount),
    paymentMethod: p.paymentMethod,
    paymentMethodLabel: paymentMethodLabel(p.paymentMethod),
    paidAt: (p.paidAt ?? p.createdAt).toISOString(),
    isCurrent: p.id === payment.id,
  }))

  const item: CashFlowItem = {
    id: `income:${payment.id}`,
    type: "INCOME",
    typeLabel: CASH_FLOW_TYPE_LABELS.INCOME,
    source: "PAYMENT",
    sourceLabel: CASH_FLOW_SOURCE_LABELS.PAYMENT,
    date: effectiveDate.toISOString(),
    dayKey: toDayKey(effectiveDate),
    amount: roundMoney(payment.amount),
    status,
    description: patientName
      ? `Pagamento — ${patientName}`
      : `Recebimento — ${paymentMethodLabel(payment.paymentMethod)}`,
    paymentId: payment.id,
    appointmentId: payment.appointmentId,
    appointmentCode: appointmentCode(payment.appointmentId),
    patientId: appt?.patientId ?? null,
    patientName,
    professionalName: appt?.finishedByName ?? null,
    procedures,
    expenseId: null,
    expensePaymentId: null,
    supplier: null,
    categoryId: null,
    categoryName: null,
    categoryKind: null,
    paymentMethod: payment.paymentMethod,
    paymentMethodLabel: paymentMethodLabel(payment.paymentMethod),
    runningBalance,
    reversedAt: status === "reversed" ? effectiveDate.toISOString() : null,
    reverseReason: null,
    reversedByName: null,
  }

  return {
    ...item,
    relatedPayments,
    originContext: {
      expectedTotal: roundMoney(expectedTotal),
      receivedTotal: roundMoney(receivedTotal),
      pendingTotal,
      appointmentDate: appt?.appointmentDate.toISOString() ?? null,
      appointmentTime: appt?.appointmentTime ?? null,
      appointmentStatus: appt?.status ?? null,
      expenseAmount: null,
      expenseBalance: null,
      expenseStatus: null,
      expenseDueDate: null,
      documentNumber: null,
      notes: null,
    },
  }
}

/** Detalhe de uma SAÍDA (origem: `expense_payments`). */
async function buildExpenseDetail(
  expensePaymentId: string
): Promise<CashFlowDetail | null> {
  const payment = await prisma.expensePayment.findUnique({
    where: { id: expensePaymentId },
    select: {
      id: true,
      amount: true,
      paymentMethod: true,
      paidAt: true,
      notes: true,
      expense: {
        select: {
          id: true,
          description: true,
          supplier: true,
          amount: true,
          status: true,
          dueDate: true,
          notes: true,
          categoryId: true,
          category: { select: { id: true, name: true, kind: true } },
          payments: {
            select: { id: true, amount: true, paymentMethod: true, paidAt: true },
            orderBy: { paidAt: "asc" },
          },
        },
      },
    },
  })
  if (!payment) return null

  const expense = payment.expense
  const opening = await computeOpeningBalance(payment.paidAt)
  const runningBalance = roundMoney(opening - payment.amount)

  const paidTotal = expense.payments.reduce((s, p) => s + p.amount, 0)
  const balance = Math.max(roundMoney(expense.amount - paidTotal), 0)

  const relatedPayments = expense.payments.map((p) => ({
    id: p.id,
    amount: roundMoney(p.amount),
    paymentMethod: p.paymentMethod,
    paymentMethodLabel: paymentMethodLabel(p.paymentMethod),
    paidAt: p.paidAt.toISOString(),
    isCurrent: p.id === payment.id,
  }))

  const item: CashFlowItem = {
    id: `expense:${payment.id}`,
    type: "EXPENSE",
    typeLabel: CASH_FLOW_TYPE_LABELS.EXPENSE,
    source: "EXPENSE_PAYMENT",
    sourceLabel: CASH_FLOW_SOURCE_LABELS.EXPENSE_PAYMENT,
    date: payment.paidAt.toISOString(),
    dayKey: toDayKey(payment.paidAt),
    amount: roundMoney(payment.amount),
    status: "settled",
    description: expense.description,
    paymentId: null,
    appointmentId: null,
    appointmentCode: null,
    patientId: null,
    patientName: null,
    professionalName: null,
    procedures: [],
    expenseId: expense.id,
    expensePaymentId: payment.id,
    supplier: expense.supplier,
    categoryId: expense.category?.id ?? expense.categoryId,
    categoryName: expense.category?.name ?? null,
    categoryKind: expense.category?.kind ?? null,
    paymentMethod: payment.paymentMethod,
    paymentMethodLabel: paymentMethodLabel(payment.paymentMethod),
    runningBalance,
    reversedAt: null,
    reverseReason: null,
    reversedByName: null,
  }

  return {
    ...item,
    relatedPayments,
    originContext: {
      expectedTotal: null,
      receivedTotal: null,
      pendingTotal: null,
      appointmentDate: null,
      appointmentTime: null,
      appointmentStatus: null,
      expenseAmount: roundMoney(expense.amount),
      expenseBalance: balance,
      expenseStatus: expense.status,
      expenseDueDate: expense.dueDate?.toISOString() ?? null,
      documentNumber: null,
      notes: expense.notes ?? payment.notes,
    },
  }
}

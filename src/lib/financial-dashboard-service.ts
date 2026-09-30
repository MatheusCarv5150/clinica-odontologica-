// ===========================================================================
// DASHBOARD FINANCEIRO — módulo Financeiro (Parte 11 — Financeiro 1).
// ===========================================================================
//
// Projeção dos dados REAIS de `financial_transactions`, `payments`,
// `appointments` e `expenses`. Nada é inventado: sem dados => R$ 0,00.
//
// DISTINÇÕES OBRIGATÓRIAS mantidas aqui:
//   receita  ≠ previsão   (recebido só conta pagamento efetivado)
//   pendente ≠ excedente  (excedente é sinalizado, não somado a pendente)
//   previsto ≠ cobrado ≠ recebido
//
// O paciente é SEMPRE resolvido no servidor a partir do vínculo da
// movimentação — nunca aceito do cliente como definição de acesso.

import { prisma } from "@/lib/prisma"
import {
  aggregateFlow,
  computeAppointmentValues,
  fromCents,
  isBillableAppointmentStatus,
  monthKeyLabel,
  paymentMethodLabel,
  resolvePeriodRange,
  roundMoney,
  safeText,
  toCents,
  toDayKey,
  toMonthKey,
  type FlowTotals,
} from "@/lib/financial-domain"

export interface DashboardTransactionItem {
  id: string
  direction: string
  status: string
  amount: number
  competenceDate: string
  description: string
  paymentMethod: string | null
  paymentMethodLabel: string
  patientId: string | null
  patientName: string | null
  appointmentId: string | null
  source: "payment" | "expense"
  /** Excedente sobre o previsto do atendimento (só em receitas). */
  overpaidAmount: number | null
}

export interface DashboardCard {
  /** Total efetivado no período. */
  total: number
  /** Total previsto (ainda não efetivado) no período. */
  expected: number
  /** Contagem de registros considerados. */
  count: number
}

export interface DashboardSeriesPoint {
  key: string
  label: string
  income: number
  expense: number
  net: number
}

export interface DashboardCategorySlice {
  categoryId: string
  name: string
  kind: string
  amount: number
  count: number
  sharePercent: number
}

export interface DashboardMethodSlice {
  method: string
  label: string
  amount: number
  count: number
  sharePercent: number
}

export interface DashboardIntegrityIssue {
  appointmentId: string
  patientName: string
  /** Campos por tipo de alerta. */
  expected?: number
  received?: number
  overpaid?: number
  declaredTotal?: number
  proceduresTotal?: number
  diff?: number
}

export interface FinancialDashboard {
  period: {
    preset: string
    start: string
    end: string
  }
  /** Caixa efetivado no período (entradas, saídas e resultado). */
  cash: FlowTotals
  /** Receitas (entradas) — consolidado do período. */
  income: DashboardCard
  /** Despesas (saídas) — consolidado do período. */
  expense: DashboardCard
  /** Contas a receber: PREVISÃO derivada dos atendimentos, não receita. */
  accountsReceivable: {
    total: number
    count: number
    /** Parcela vencida (data do atendimento anterior à referência). */
    overdue: number
    overdueCount: number
  }
  /** Série temporal (diária ou mensal, conforme o período). */
  series: {
    granularity: "day" | "month"
    points: DashboardSeriesPoint[]
  }
  /** Despesas por categoria — só categorias com valor REAL. */
  expensesByCategory: DashboardCategorySlice[]
  /** Recebimentos por forma de pagamento — só formas com valor REAL. */
  incomeByMethod: DashboardMethodSlice[]
  /** Movimentações recentes do período (ordem decrescente). */
  recentTransactions: DashboardTransactionItem[]
  /** Alertas de integridade — nunca silenciam inconsistência real. */
  integrity: {
    overpaidAppointments: DashboardIntegrityIssue[]
    declaredVsProceduresMismatch: DashboardIntegrityIssue[]
  }
  /** Metadados do cálculo (transparência para a UI e para auditoria). */
  meta: {
    transactionsConsidered: number
    unpaidAppointmentsConsidered: number
    generatedAt: string
  }
}

const MAX_SERIES_POINTS = 62
const RECENT_LIMIT = 12
const INTEGRITY_LIMIT = 10

/**
 * Monta o Dashboard Financeiro do período.
 *
 * Não dispara sincronização — a rota decide quando sincronizar.
 */
export async function getFinancialDashboard(options: {
  preset: string
  from?: string
  to?: string
  reference?: Date
}): Promise<FinancialDashboard> {
  const { start, end } = resolvePeriodRange(options.preset, options.reference, {
    from: options.from,
    to: options.to,
  })

  // -------------------------------------------------------------------------
  // 1) Movimentações do período (fonte consolidada)
  // -------------------------------------------------------------------------
  const transactions = await prisma.financialTransaction.findMany({
    where: { competenceDate: { gte: start, lte: end } },
    select: {
      id: true,
      direction: true,
      status: true,
      amount: true,
      competenceDate: true,
      description: true,
      paymentMethod: true,
      patientId: true,
      appointmentId: true,
      paymentId: true,
      expenseId: true,
    },
    orderBy: { competenceDate: "desc" },
  })

  const cash = aggregateFlow(transactions)

  // Cards de receita/despesa SEPARADOS por natureza.
  let incomeSettled = 0
  let incomeExpected = 0
  let incomeCount = 0
  let expenseSettled = 0
  let expenseExpected = 0
  let expenseCount = 0

  for (const t of transactions) {
    if (t.status === "cancelled" || t.status === "reversed") continue
    const cents = toCents(t.amount)
    if (t.direction === "in") {
      incomeCount++
      if (t.status === "settled") incomeSettled += cents
      else incomeExpected += cents
    } else if (t.direction === "out") {
      expenseCount++
      if (t.status === "settled") expenseSettled += cents
      else expenseExpected += cents
    }
  }

  // -------------------------------------------------------------------------
  // 2) Contas a receber — PREVISÃO derivada dos atendimentos
  // -------------------------------------------------------------------------
  // Contas a receber consideram apenas atendimentos do PERÍODO (mesma janela
  // das movimentações), evitando arrastar passivos antigos para o filtro atual
  // e mantendo os alertas de integridade alinhados ao que está sendo exibido.
  const appointments = await prisma.appointment.findMany({
    where: {
      appointmentDate: { gte: start, lte: end },
      status: { notIn: ["cancelled", "no_show"] },
    },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      appointmentDate: true,
      patient: { select: { id: true, fullName: true } },
      procedures: { select: { totalPrice: true } },
      payments: { select: { amount: true, status: true } },
    },
  })

  let receivableCents = 0
  let receivableCount = 0
  let overdueCents = 0
  let overdueCount = 0
  let unpaidAppointmentsConsidered = 0

  const overpaid: DashboardIntegrityIssue[] = []
  const mismatch: DashboardIntegrityIssue[] = []

  const ref = options.reference ?? new Date()

  for (const appt of appointments) {
    if (!isBillableAppointmentStatus(appt.status)) continue

    const proceduresTotal = appt.procedures.reduce((s, p) => s + p.totalPrice, 0)
    const paidTotal = appt.payments
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + p.amount, 0)

    const values = computeAppointmentValues({
      totalAmount: appt.totalAmount,
      proceduresTotal,
      paidTotal,
    })

    // Integridade: divergência entre total declarado e soma dos procedimentos.
    if (values.declaredVsProceduresDiff != null) {
      mismatch.push({
        appointmentId: appt.id,
        patientName: appt.patient.fullName,
        declaredTotal: values.declaredTotal ?? 0,
        proceduresTotal: values.proceduresTotal,
        diff: values.declaredVsProceduresDiff,
      })
    }

    // Integridade: recebido acima do previsto (não distorce "pendente").
    if (values.overpaid > 0) {
      overpaid.push({
        appointmentId: appt.id,
        patientName: appt.patient.fullName,
        expected: values.expected,
        received: values.received,
        overpaid: values.overpaid,
      })
    }

    if (values.pending > 0) {
      const cents = toCents(values.pending)
      receivableCents += cents
      receivableCount++
      unpaidAppointmentsConsidered++

      if (appt.appointmentDate < ref) {
        overdueCents += cents
        overdueCount++
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3) Série temporal
  // -------------------------------------------------------------------------
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const spanDays = Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY)
  const granularity: "day" | "month" = spanDays > MAX_SERIES_POINTS ? "month" : "day"

  const seriesMap = new Map<string, { incomeCents: number; expenseCents: number }>()

  if (granularity === "day") {
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    let guard = 0
    while (cursor <= last && guard < 400) {
      seriesMap.set(toDayKey(cursor), { incomeCents: 0, expenseCents: 0 })
      cursor.setDate(cursor.getDate() + 1)
      guard++
    }
  } else {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    const last = new Date(end.getFullYear(), end.getMonth(), 1)
    let guard = 0
    while (cursor <= last && guard < 120) {
      seriesMap.set(toMonthKey(cursor), { incomeCents: 0, expenseCents: 0 })
      cursor.setMonth(cursor.getMonth() + 1)
      guard++
    }
  }

  for (const t of transactions) {
    if (t.status === "cancelled" || t.status === "reversed") continue
    const key =
      granularity === "day" ? toDayKey(t.competenceDate) : toMonthKey(t.competenceDate)
    const bucket = seriesMap.get(key)
    if (!bucket) continue
    const cents = toCents(t.amount)
    if (t.direction === "in") bucket.incomeCents += cents
    else if (t.direction === "out") bucket.expenseCents += cents
  }

  const allPoints: DashboardSeriesPoint[] = [...seriesMap.entries()].map(([key, v]) => ({
    key,
    label:
      granularity === "day"
        ? `${key.slice(8)}/${key.slice(5, 7)}`
        : monthKeyLabel(key),
    income: fromCents(v.incomeCents),
    expense: fromCents(v.expenseCents),
    net: fromCents(v.incomeCents - v.expenseCents),
  }))

  const points =
    allPoints.length > MAX_SERIES_POINTS
      ? allPoints.slice(allPoints.length - MAX_SERIES_POINTS)
      : allPoints

  // -------------------------------------------------------------------------
  // 4) Despesas por categoria (só categorias com valor REAL)
  // -------------------------------------------------------------------------
  const expenseTx = transactions.filter(
    (t) => t.direction === "out" && t.status !== "cancelled" && t.status !== "reversed"
  )
  const expenseIds = expenseTx
    .map((t) => t.expenseId)
    .filter((v): v is string => v !== null)

  const expenseRows = expenseIds.length
    ? await prisma.expense.findMany({
        where: { id: { in: expenseIds } },
        select: {
          id: true,
          category: { select: { id: true, name: true, kind: true } },
        },
      })
    : []

  const expenseById = new Map(expenseRows.map((e) => [e.id, e]))
  const categoryAgg = new Map<
    string,
    { name: string; kind: string; cents: number; count: number }
  >()

  for (const t of expenseTx) {
    if (!t.expenseId) continue
    const row = expenseById.get(t.expenseId)
    if (!row) continue
    const key = row.category.id
    const entry =
      categoryAgg.get(key) ??
      { name: row.category.name, kind: row.category.kind, cents: 0, count: 0 }
    entry.cents += toCents(t.amount)
    entry.count++
    categoryAgg.set(key, entry)
  }

  const expenseTotalCents = [...categoryAgg.values()].reduce((s, v) => s + v.cents, 0)
  const expensesByCategory: DashboardCategorySlice[] = [...categoryAgg.entries()]
    .map(([categoryId, v]) => ({
      categoryId,
      name: v.name,
      kind: v.kind,
      amount: fromCents(v.cents),
      count: v.count,
      sharePercent:
        expenseTotalCents > 0 ? roundMoney((v.cents / expenseTotalCents) * 100) : 0,
    }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  // -------------------------------------------------------------------------
  // 5) Recebimentos por forma de pagamento (só formas com valor REAL)
  // -------------------------------------------------------------------------
  const incomeTx = transactions.filter(
    (t) => t.direction === "in" && t.status !== "cancelled" && t.status !== "reversed"
  )
  const methodAgg = new Map<string, { cents: number; count: number }>()
  for (const t of incomeTx) {
    const key = (t.paymentMethod ?? "").trim() || "nao_informado"
    const entry = methodAgg.get(key) ?? { cents: 0, count: 0 }
    entry.cents += toCents(t.amount)
    entry.count++
    methodAgg.set(key, entry)
  }
  const incomeTotalCents = [...methodAgg.values()].reduce((s, v) => s + v.cents, 0)
  const incomeByMethod: DashboardMethodSlice[] = [...methodAgg.entries()]
    .map(([method, v]) => ({
      method,
      label: method === "nao_informado" ? "Não informado" : paymentMethodLabel(method),
      amount: fromCents(v.cents),
      count: v.count,
      sharePercent:
        incomeTotalCents > 0 ? roundMoney((v.cents / incomeTotalCents) * 100) : 0,
    }))
    .sort((a, b) => toCents(b.amount) - toCents(a.amount))

  // -------------------------------------------------------------------------
  // 6) Movimentações recentes (com paciente resolvido no servidor)
  // -------------------------------------------------------------------------
  const recentRaw = transactions.slice(0, RECENT_LIMIT)

  const patientIds = [
    ...new Set(recentRaw.map((t) => t.patientId).filter((v): v is string => v !== null)),
  ]
  const patients = patientIds.length
    ? await prisma.patient.findMany({
        where: { id: { in: patientIds } },
        select: { id: true, fullName: true },
      })
    : []
  const patientNameById = new Map(patients.map((p) => [p.id, p.fullName]))

  const overpaidByAppointment = new Map(
    overpaid.map((o) => [o.appointmentId, o.overpaid ?? 0])
  )

  const recentTransactions: DashboardTransactionItem[] = recentRaw.map((t) => ({
    id: t.id,
    direction: t.direction,
    status: t.status,
    amount: roundMoney(t.amount),
    competenceDate: t.competenceDate.toISOString(),
    description: safeText(t.description, "Movimentação"),
    paymentMethod: t.paymentMethod,
    paymentMethodLabel: t.paymentMethod ? paymentMethodLabel(t.paymentMethod) : "—",
    patientId: t.patientId,
    patientName: t.patientId ? patientNameById.get(t.patientId) ?? null : null,
    appointmentId: t.appointmentId,
    source: t.paymentId ? "payment" : "expense",
    overpaidAmount:
      t.appointmentId && t.direction === "in"
        ? overpaidByAppointment.get(t.appointmentId) ?? null
        : null,
  }))

  // -------------------------------------------------------------------------
  // 7) Resultado
  // -------------------------------------------------------------------------
  return {
    period: {
      preset: options.preset,
      start: start.toISOString(),
      end: end.toISOString(),
    },
    cash,
    income: {
      total: fromCents(incomeSettled),
      expected: fromCents(incomeExpected),
      count: incomeCount,
    },
    expense: {
      total: fromCents(expenseSettled),
      expected: fromCents(expenseExpected),
      count: expenseCount,
    },
    accountsReceivable: {
      total: fromCents(receivableCents),
      count: receivableCount,
      overdue: fromCents(overdueCents),
      overdueCount,
    },
    series: { granularity, points },
    expensesByCategory,
    incomeByMethod,
    recentTransactions,
    integrity: {
      overpaidAppointments: overpaid.slice(0, INTEGRITY_LIMIT),
      declaredVsProceduresMismatch: mismatch.slice(0, INTEGRITY_LIMIT),
    },
    meta: {
      transactionsConsidered: transactions.length,
      unpaidAppointmentsConsidered,
      generatedAt: new Date().toISOString(),
    },
  }
}

// ===========================================================================
// SERVIÇO DE RELATÓRIOS FINANCEIROS — módulo Financeiro (Financeiro 6).
// ===========================================================================
//
// O QUE ESTE SERVIÇO É
//
// A camada de CONSOLIDAÇÃO dos relatórios do módulo Financeiro. Ele responde
// às perguntas de negócio (quanto entrou, quanto saiu, quanto falta receber,
// quais procedimentos geraram receita, quais formas de pagamento foram usadas
// etc.) REUTILIZANDO os serviços já existentes dos Financeiros 1–5.
//
// ---------------------------------------------------------------------------
// REGRA MAIS IMPORTANTE: NÃO CRIAR UMA SEGUNDA FONTE DE VERDADE
// ---------------------------------------------------------------------------
//
// Este serviço NÃO persiste nada e NÃO recalcula regras financeiras. Ele
// ORQUESTRA os serviços canônicos:
//
//   Resumo / fluxo / métodos / categorias
//        -> `listCashFlow` (Financeiro 5) — deriva de payments/expense_payments
//   Receitas
//        -> `listReceitas` (Financeiro 2)
//   Despesas
//        -> `listDespesas` (Financeiro 4)
//   Contas a receber
//        -> `listContasReceber` (Financeiro 3)
//
// Se um número aparece em dois lugares, ele vem da MESMA função. Não há
// "cálculo alternativo" de saldo, receita ou despesa neste arquivo.
//
// ---------------------------------------------------------------------------
// RECEITA RECEBIDA x ENTRADA DE CAIXA
// ---------------------------------------------------------------------------
// Nesta arquitetura o caixa realizado é alimentado por:
//   * ENTRADA -> `payments.status = "paid"`  (recebimento efetivo)
//   * SAÍDA   -> `expense_payments`          (pagamento efetivo)
// Como toda entrada de caixa nasce de um pagamento recebido, "receita
// recebida" e "entrada de caixa" coincidem quando consideram o mesmo conjunto
// (pagamentos efetivados). A diferença aparece em recebimentos PENDENTES
// (previstos) ou ESTORNADOS: eles são receita prevista/revertida, nunca caixa.
// Por isso:
//   * "Receitas recebidas"  = pagamentos com status "paid"
//   * "Entradas no caixa"   = mesmos pagamentos, na projeção do fluxo
//   * "Receitas previstas"  = conta a receber, NÃO é caixa
//
// ---------------------------------------------------------------------------
// RESULTADO FINANCEIRO (não é lucro contábil)
// ---------------------------------------------------------------------------
//   Resultado financeiro do período = receitas recebidas - despesas pagas
// NUNCA exibido como lucro, lucro líquido ou EBITDA (o sistema não possui
// contabilidade completa).

import { prisma } from "@/lib/prisma"
import { fromCents, paymentMethodLabel, roundMoney, toCents, toDayKey } from "@/lib/financial-domain"
import { listCashFlow, type CashFlowType } from "@/lib/financial-cash-flow-service"
import { listReceitas } from "@/lib/financial-receitas-service"
import { listDespesas } from "@/lib/financial-expense-service"
import { listContasReceber } from "@/lib/financial-contas-receber-service"

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface ReportPeriod {
  preset: string
  from: string
  to: string
}

export interface ReportDefinition {
  label: string
  definition: string
  nature: "receita" | "despesa" | "saldo" | "previsao" | "resultado" | "contagem"
}

export interface FinancialSummaryCard {
  key: string
  definition: ReportDefinition
  value: number
  secondaryValue: number | null
  secondaryLabel: string | null
}

export interface FinancialSummaryReport {
  period: ReportPeriod
  cards: FinancialSummaryCard[]
  result: {
    label: string
    value: number
    income: number
    expense: number
    definition: string
  }
  balanceNote: string
  meta: { generatedAt: string }
}

export interface BreakdownItem {
  key: string
  label: string
  amount: number
  count: number
  sharePercent: number
}

export interface Pagination {
  page: number
  pageSize: number
  totalPages: number
  totalCount: number
}

export interface IncomeReportTableRow {
  date: string
  patientName: string
  appointmentCode: string | null
  procedures: string
  professionalName: string | null
  paymentMethodLabel: string
  amount: number
  status: string
}

export interface IncomeReport {
  period: ReportPeriod
  totalReceived: number
  receivedCount: number
  averageTicket: number
  totalPending: number
  pendingCount: number
  partialCount: number
  byDay: BreakdownItem[]
  byProcedure: BreakdownItem[]
  byProfessional: BreakdownItem[]
  byMethod: BreakdownItem[]
  byPatient: BreakdownItem[]
  rows: IncomeReportTableRow[]
  pagination: Pagination
  meta: { generatedAt: string }
}

export interface ExpenseReportTableRow {
  date: string
  description: string
  categoryName: string
  supplier: string | null
  dueDate: string | null
  amount: number
  paidAmount: number
  balance: number
  status: string
  statusLabel: string
}

export interface ExpenseReport {
  period: ReportPeriod
  totalExpenses: number
  totalPaid: number
  totalPending: number
  totalOverdue: number
  totalCount: number
  paidCount: number
  pendingCount: number
  overdueCount: number
  byCategory: BreakdownItem[]
  byDay: BreakdownItem[]
  byMethod: BreakdownItem[]
  rows: ExpenseReportTableRow[]
  pagination: Pagination
  meta: { generatedAt: string }
}

export interface CashFlowReportRow {
  date: string
  type: CashFlowType
  typeLabel: string
  originLabel: string
  description: string
  counterparty: string | null
  paymentMethodLabel: string
  amount: number
  runningBalance: number
  status: string
}

export interface CashFlowReport {
  period: ReportPeriod
  totalIncome: number
  totalExpense: number
  periodBalance: number
  openingBalance: number
  closingBalance: number
  incomeCount: number
  expenseCount: number
  series: { key: string; label: string; income: number; expense: number; net: number }[]
  daily: { dayKey: string; date: string; income: number; expense: number; net: number }[]
  weekly: {
    key: string
    label: string
    start: string
    end: string
    income: number
    expense: number
    net: number
  }[]
  months: { key: string; label: string; income: number; expense: number; net: number }[]
  rows: CashFlowReportRow[]
  balanceNote: string
  meta: { generatedAt: string }
}

export interface ReceivableReportRow {
  patientName: string
  appointmentCode: string
  procedures: string
  chargedAt: string
  dueDate: string
  expectedAmount: number
  receivedAmount: number
  balance: number
  status: string
  statusLabel: string
}

export interface ReceivableReport {
  period: ReportPeriod
  totalCharged: number
  totalReceived: number
  totalPending: number
  totalOverdue: number
  totalUpcoming: number
  totalDueToday: number
  totalCount: number
  openCount: number
  overdueCount: number
  partialCount: number
  settledCount: number
  cancelledCount: number
  rows: ReceivableReportRow[]
  pagination: Pagination
  meta: { generatedAt: string }
}

export interface ProcedureReportRow {
  name: string
  quantity: number
  chargedAmount: number
  receivedAmount: number
  pendingAmount: number
  shareOfReceivedPercent: number
}

export interface ProcedureReport {
  period: ReportPeriod
  totalCharged: number
  totalReceived: number
  totalPending: number
  totalQuantity: number
  rows: ProcedureReportRow[]
  meta: { generatedAt: string }
}

export interface PaymentMethodReportRow {
  method: string
  label: string
  count: number
  amount: number
  sharePercent: number
}

export interface PaymentMethodReport {
  period: ReportPeriod
  totalReceived: number
  totalCount: number
  rows: PaymentMethodReportRow[]
  meta: { generatedAt: string }
}

export interface ReportsOverview {
  period: ReportPeriod
  summary: FinancialSummaryReport
  charts: {
    incomeVsExpense: { key: string; label: string; income: number; expense: number }[]
    incomeByMethod: { key: string; label: string; amount: number; sharePercent: number }[]
    incomeByProcedure: { key: string; label: string; amount: number; sharePercent: number }[]
    expenseByCategory: { key: string; label: string; amount: number; sharePercent: number }[]
    balanceEvolution: { key: string; label: string; balance: number }[]
  }
  meta: { generatedAt: string }
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function sharePercent(amountCents: number, totalCents: number): number {
  if (totalCents <= 0) return 0
  return roundMoney((amountCents / totalCents) * 100)
}

function dayKeyShortLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  return m ? `${m[3]}/${m[2]}` : key
}

/** Procedimentos concatenados num rótulo legível. */
function proceduresLabel(procedures: { name: string; quantity: number }[]): string {
  if (procedures.length === 0) return "—"
  return procedures
    .map((p) => (p.quantity > 1 ? `${p.name} (${p.quantity})` : p.name))
    .join(", ")
}

/** Semana (segunda a domingo) que contém a data. */
function weekKey(date: Date): { key: string; start: Date; end: Date } {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = d.getDay() // 0=domingo
  const diffToMonday = day === 0 ? -6 : 1 - day
  const start = new Date(d)
  start.setDate(d.getDate() + diffToMonday)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const yearStart = new Date(start.getFullYear(), 0, 1)
  const weekNum =
    Math.floor((start.getTime() - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1
  return { key: `${start.getFullYear()}-W${String(weekNum).padStart(2, "0")}`, start, end }
}

function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

/** Rótulo "DD/MM" a partir de uma Date. */
function shortDay(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}/${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`
}

// ===========================================================================
// RESUMO FINANCEIRO
// ===========================================================================
// Reutiliza `listCashFlow` (origem única dos totais de caixa) e complementa
// com contas a receber (Financeiro 3) e despesas a pagar (Financeiro 4).

export async function getFinancialSummary(options: {
  period?: string
  from?: string
  to?: string
}): Promise<FinancialSummaryReport> {
  const period = options.period ?? "month"
  const [cash, receivable, expenses] = await Promise.all([
    listCashFlow({ period, from: options.from, to: options.to, page: 1, pageSize: 1 }),
    listContasReceber({ period, from: options.from, to: options.to, page: 1, pageSize: 1 }),
    listDespesas({ period, from: options.from, to: options.to, page: 1, pageSize: 1 }),
  ])

  const income = cash.totals.totalIncome
  const expense = cash.totals.totalExpense
  const result = roundMoney(income - expense)

  const receivableOpen = receivable.summary.totalBalance
  const payableOpen = roundMoney(
    expenses.summary.totalExpenses - expenses.summary.totalPaid
  )

  const cards: FinancialSummaryCard[] = [
    {
      key: "income",
      definition: {
        label: "Receitas recebidas",
        definition: "Pagamentos efetivamente recebidos no período.",
        nature: "receita",
      },
      value: income,
      secondaryValue: cash.totals.incomeCount,
      secondaryLabel: "recebimentos",
    },
    {
      key: "expense",
      definition: {
        label: "Despesas pagas",
        definition: "Pagamentos de despesas efetivamente realizados no período.",
        nature: "despesa",
      },
      value: expense,
      secondaryValue: cash.totals.expenseCount,
      secondaryLabel: "pagamentos",
    },
    {
      key: "cashIn",
      definition: {
        label: "Entradas no caixa",
        definition:
          "Dinheiro que entrou no caixa no período (pagamentos recebidos). Igual a receitas recebidas, pois toda entrada nasce de um pagamento.",
        nature: "receita",
      },
      value: cash.totals.totalIncome,
      secondaryValue: cash.totals.incomeCount,
      secondaryLabel: "movimentações",
    },
    {
      key: "cashOut",
      definition: {
        label: "Saídas do caixa",
        definition: "Dinheiro que saiu do caixa no período (pagamentos de despesas).",
        nature: "despesa",
      },
      value: cash.totals.totalExpense,
      secondaryValue: cash.totals.expenseCount,
      secondaryLabel: "movimentações",
    },
    {
      key: "periodBalance",
      definition: {
        label: "Saldo do período",
        definition: "Entradas menos saídas do período (caixa realizado).",
        nature: "saldo",
      },
      value: cash.totals.periodBalance,
      secondaryValue: null,
      secondaryLabel: null,
    },
    {
      key: "receivable",
      definition: {
        label: "Contas a receber",
        definition:
          "Saldo em aberto de contas a receber. É PREVISÃO — não é receita recebida.",
        nature: "previsao",
      },
      value: receivableOpen,
      secondaryValue: receivable.summary.openCount + receivable.summary.overdueCount,
      secondaryLabel: "contas em aberto",
    },
    {
      key: "payable",
      definition: {
        label: "Despesas a pagar",
        definition:
          "Saldo em aberto de despesas registradas e ainda não pagas. É compromisso — não é saída de caixa.",
        nature: "previsao",
      },
      value: payableOpen,
      secondaryValue: expenses.summary.pendingCount,
      secondaryLabel: "despesas em aberto",
    },
    {
      key: "result",
      definition: {
        label: "Resultado financeiro do período",
        definition:
          "Receitas recebidas menos despesas pagas. Não é lucro contábil nem EBITDA.",
        nature: "resultado",
      },
      value: result,
      secondaryValue: null,
      secondaryLabel: null,
    },
  ]

  return {
    period: { preset: cash.period.preset, from: cash.period.from, to: cash.period.to },
    cards,
    result: {
      label: "Resultado financeiro do período",
      value: result,
      income,
      expense,
      definition:
        "Receitas recebidas menos despesas pagas no período. Não representa lucro contábil (o sistema não possui contabilidade completa).",
    },
    balanceNote: cash.balanceNote.message,
    meta: { generatedAt: new Date().toISOString() },
  }
}

// ===========================================================================
// RELATÓRIO DE RECEITAS
// ===========================================================================
// Reutiliza `listReceitas` (Financeiro 2) para totais e tabela, e
// `listCashFlow` (Financeiro 5) para séries por dia/método. As quebras por
// procedimento/profissional/paciente são derivadas dos itens de receita
// (rateio proporcional ao snapshot histórico do procedimento).

export async function getIncomeReport(options: {
  period?: string
  from?: string
  to?: string
  status?: string
  paymentMethod?: string
  professionalName?: string
  search?: string
  page?: number
  pageSize?: number
}): Promise<IncomeReport> {
  const period = options.period ?? "month"
  const [receitas, cash] = await Promise.all([
    listReceitas({
      period,
      from: options.from,
      to: options.to,
      status: options.status,
      paymentMethod: options.paymentMethod,
      professionalName: options.professionalName,
      search: options.search,
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 20,
      sort: "date",
      direction: "desc",
    }),
    listCashFlow({
      period,
      from: options.from,
      to: options.to,
      type: "INCOME",
      paymentMethod: options.paymentMethod,
      professionalName: options.professionalName,
      search: options.search,
      page: 1,
      pageSize: 100,
    }),
  ])

  const procedureMap = new Map<string, { label: string; cents: number; count: number }>()
  const professionalMap = new Map<string, { label: string; cents: number; count: number }>()
  const patientMap = new Map<string, { label: string; cents: number; count: number }>()

  for (const r of receitas.receitas) {
    if (r.status === "cancelled" || r.status === "reversed") continue
    const cents = toCents(r.amount)

    const procTotal = r.procedures.reduce((s, p) => s + toCents(p.totalPrice), 0)
    if (r.procedures.length === 0 || procTotal <= 0) {
      const entry = procedureMap.get("__none__") ?? {
        label: "Sem procedimento vinculado",
        cents: 0,
        count: 0,
      }
      entry.cents += cents
      entry.count += 1
      procedureMap.set("__none__", entry)
    } else {
      for (const p of r.procedures) {
        const entry = procedureMap.get(p.name) ?? { label: p.name, cents: 0, count: 0 }
        // Rateio proporcional ao valor do procedimento no snapshot histórico.
        entry.cents += Math.round((cents * toCents(p.totalPrice)) / procTotal)
        entry.count += p.quantity
        procedureMap.set(p.name, entry)
      }
    }

    const profKey = r.professionalName?.trim() || "__none__"
    const profEntry = professionalMap.get(profKey) ?? {
      label: r.professionalName?.trim() || "Não informado",
      cents: 0,
      count: 0,
    }
    profEntry.cents += cents
    profEntry.count += 1
    professionalMap.set(profKey, profEntry)

    const patientKey = r.patientId ?? r.patientName
    const patEntry = patientMap.get(patientKey) ?? { label: r.patientName, cents: 0, count: 0 }
    patEntry.cents += cents
    patEntry.count += 1
    patientMap.set(patientKey, patEntry)
  }

  const receivedCents = toCents(receitas.summary.totalReceived)
  const build = (
    map: Map<string, { label: string; cents: number; count: number }>
  ): BreakdownItem[] =>
    Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        label: v.label,
        amount: fromCents(v.cents),
        count: v.count,
        sharePercent: sharePercent(v.cents, receivedCents),
      }))
      .sort((a, b) => b.amount - a.amount)

  const byDay = cash.daily
    .filter((d) => d.income > 0)
    .map((d) => ({
      key: d.dayKey,
      label: dayKeyShortLabel(d.dayKey),
      amount: d.income,
      count: d.incomeCount,
      sharePercent: sharePercent(toCents(d.income), toCents(cash.totals.totalIncome)),
    }))

  const byMethod = cash.byMethod.map((m) => ({
    key: m.method,
    label: m.label,
    amount: m.amount,
    count: m.count,
    sharePercent: sharePercent(toCents(m.amount), toCents(cash.totals.totalIncome)),
  }))

  return {
    period: {
      preset: receitas.period.preset,
      from: receitas.period.from,
      to: receitas.period.to,
    },
    totalReceived: receitas.summary.totalReceived,
    receivedCount: receitas.summary.receivedCount,
    averageTicket: receitas.summary.averageTicket,
    totalPending: receitas.summary.totalPending,
    pendingCount: receitas.summary.pendingCount,
    partialCount: receitas.summary.partialCount,
    byDay,
    byProcedure: build(procedureMap),
    byProfessional: build(professionalMap),
    byMethod,
    byPatient: build(patientMap),
    rows: receitas.receitas.map((r) => ({
      date: r.receivedAt ?? r.createdAt,
      patientName: r.patientName,
      appointmentCode: r.appointmentCode,
      procedures: proceduresLabel(r.procedures),
      professionalName: r.professionalName,
      paymentMethodLabel: r.paymentMethodLabel,
      amount: r.amount,
      status: r.status,
    })),
    pagination: receitas.pagination,
    meta: { generatedAt: new Date().toISOString() },
  }
}

// ===========================================================================
// RELATÓRIO DE DESPESAS
// ===========================================================================
// Reutiliza EXCLUSIVAMENTE `listDespesas` (Financeiro 4, estrutura
// consolidada). Não recupera implementações antigas.

export async function getExpenseReport(options: {
  period?: string
  from?: string
  to?: string
  status?: string
  categoryId?: string
  paymentMethod?: string
  supplier?: string
  search?: string
  page?: number
  pageSize?: number
  sort?: "dueDate" | "amount" | "description" | "supplier" | "competenceDate"
  direction?: "asc" | "desc"
}): Promise<ExpenseReport> {
  const period = options.period ?? "month"
  const despesas = await listDespesas({
    period,
    from: options.from,
    to: options.to,
    status: options.status,
    categoryId: options.categoryId,
    paymentMethod: options.paymentMethod,
    supplier: options.supplier,
    search: options.search,
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 20,
    sort: options.sort ?? "dueDate",
    direction: options.direction ?? "asc",
  })

  const categoryMap = new Map<string, { label: string; cents: number; count: number }>()
  const dayMap = new Map<string, { label: string; cents: number; count: number }>()
  const methodMap = new Map<string, { label: string; cents: number; count: number }>()

  for (const d of despesas.despesas) {
    if (d.status === "CANCELADA") continue
    const cents = toCents(d.amount)

    const catKey = d.categoryId ?? "__none__"
    const catEntry = categoryMap.get(catKey) ?? {
      label: d.categoryName ?? "Sem categoria",
      cents: 0,
      count: 0,
    }
    catEntry.cents += cents
    catEntry.count += 1
    categoryMap.set(catKey, catEntry)

    const dayKey = toDayKey(new Date(d.competenceDate))
    const dayEntry = dayMap.get(dayKey) ?? {
      label: dayKeyShortLabel(dayKey),
      cents: 0,
      count: 0,
    }
    dayEntry.cents += cents
    dayEntry.count += 1
    dayMap.set(dayKey, dayEntry)

    if (d.paymentMethod) {
      const methodEntry = methodMap.get(d.paymentMethod) ?? {
        label: paymentMethodLabel(d.paymentMethod),
        cents: 0,
        count: 0,
      }
      methodEntry.cents += toCents(d.paidAmount)
      if (d.paidAmount > 0) methodEntry.count += 1
      methodMap.set(d.paymentMethod, methodEntry)
    }
  }

  const totalCents = toCents(despesas.summary.totalExpenses)
  const build = (
    map: Map<string, { label: string; cents: number; count: number }>
  ): BreakdownItem[] =>
    Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        label: v.label,
        amount: fromCents(v.cents),
        count: v.count,
        sharePercent: sharePercent(v.cents, totalCents),
      }))
      .sort((a, b) => b.amount - a.amount)

  return {
    period: {
      preset: despesas.period.preset,
      from: despesas.period.from,
      to: despesas.period.to,
    },
    totalExpenses: despesas.summary.totalExpenses,
    totalPaid: despesas.summary.totalPaid,
    totalPending: despesas.summary.totalPending,
    totalOverdue: despesas.summary.totalOverdue,
    totalCount: despesas.summary.totalCount,
    paidCount: despesas.summary.paidCount,
    pendingCount: despesas.summary.pendingCount,
    overdueCount: despesas.summary.overdueCount,
    byCategory: build(categoryMap),
    byDay: Array.from(dayMap.entries())
      .map(([key, v]) => ({
        key,
        label: v.label,
        amount: fromCents(v.cents),
        count: v.count,
        sharePercent: sharePercent(v.cents, totalCents),
      }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)),
    byMethod: build(methodMap),
    rows: despesas.despesas.map((d) => ({
      date: d.competenceDate,
      description: d.description,
      categoryName: d.categoryName ?? "Sem categoria",
      supplier: d.supplier,
      dueDate: d.dueDate,
      amount: d.amount,
      paidAmount: d.paidAmount,
      balance: d.balance,
      status: d.status,
      statusLabel: d.statusLabel,
    })),
    pagination: despesas.pagination,
    meta: { generatedAt: new Date().toISOString() },
  }
}

// ===========================================================================
// RELATÓRIO DE FLUXO DE CAIXA
// ===========================================================================
// Consome o MESMO serviço da tela de Fluxo de Caixa (`listCashFlow`). Nenhuma
// regra de saldo é duplicada: período, acumulado e séries vêm prontos.

export async function getCashFlowReport(options: {
  period?: string
  from?: string
  to?: string
  type?: string
  paymentMethod?: string
  source?: string
  search?: string
  page?: number
  pageSize?: number
}): Promise<CashFlowReport> {
  const period = options.period ?? "month"
  // Lê uma janela ampla (até 100 itens) para derivar semana/mês sem paginar os
  // agregados. O serviço limita o pageSize a 100.
  const result = await listCashFlow({
    period,
    from: options.from,
    to: options.to,
    type: options.type ?? "ALL",
    paymentMethod: options.paymentMethod,
    source: options.source,
    search: options.search,
    page: 1,
    pageSize: 100,
    sort: "date",
    direction: "desc",
  })

  const weekMap = new Map<
    string,
    { income: number; expense: number; start: Date; end: Date }
  >()
  const monthMap = new Map<string, { income: number; expense: number }>()

  for (const m of result.movements) {
    if (m.status !== "settled") continue
    const cents = toCents(m.amount)
    const date = new Date(m.date)

    const wk = weekKey(date)
    const wEntry = weekMap.get(wk.key) ?? {
      income: 0,
      expense: 0,
      start: wk.start,
      end: wk.end,
    }
    if (m.type === "INCOME") wEntry.income += cents
    else wEntry.expense += cents
    weekMap.set(wk.key, wEntry)

    const mk = monthKeyOf(date)
    const mEntry = monthMap.get(mk) ?? { income: 0, expense: 0 }
    if (m.type === "INCOME") mEntry.income += cents
    else mEntry.expense += cents
    monthMap.set(mk, mEntry)
  }

  const weekly = Array.from(weekMap.entries())
    .map(([key, v]) => ({
      key,
      label: `${shortDay(v.start)} – ${shortDay(v.end)}`,
      start: toDayKey(v.start),
      end: toDayKey(v.end),
      income: fromCents(v.income),
      expense: fromCents(v.expense),
      net: fromCents(v.income - v.expense),
    }))
    .sort((a, b) => (a.start < b.start ? -1 : 1))

  const months = Array.from(monthMap.entries())
    .map(([key, v]) => ({
      key,
      label: `${key.slice(5)}/${key.slice(0, 4)}`,
      income: fromCents(v.income),
      expense: fromCents(v.expense),
      net: fromCents(v.income - v.expense),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))

  return {
    period: {
      preset: result.period.preset,
      from: result.period.from,
      to: result.period.to,
    },
    totalIncome: result.totals.totalIncome,
    totalExpense: result.totals.totalExpense,
    periodBalance: result.totals.periodBalance,
    openingBalance: result.totals.openingBalance,
    closingBalance: result.totals.closingBalance,
    incomeCount: result.totals.incomeCount,
    expenseCount: result.totals.expenseCount,
    series: result.series.points.map((p) => ({
      key: p.key,
      label: p.label,
      income: p.income,
      expense: p.expense,
      net: p.net,
    })),
    daily: result.daily.map((d) => ({
      dayKey: d.dayKey,
      date: d.date,
      income: d.income,
      expense: d.expense,
      net: d.net,
    })),
    weekly,
    months,
    rows: result.movements.map((m) => ({
      date: m.date,
      type: m.type,
      typeLabel: m.typeLabel,
      originLabel: m.sourceLabel,
      description: m.description,
      counterparty: m.patientName ?? m.supplier,
      paymentMethodLabel: m.paymentMethodLabel,
      amount: m.amount,
      runningBalance: m.runningBalance,
      status: m.status,
    })),
    balanceNote: result.balanceNote.message,
    meta: { generatedAt: new Date().toISOString() },
  }
}

// ===========================================================================
// RELATÓRIO DE CONTAS A RECEBER
// ===========================================================================
// Reutiliza o serviço do Financeiro 3. O status NÃO é recriado.

export async function getReceivableReport(options: {
  period?: string
  from?: string
  to?: string
  status?: string
  search?: string
  patientName?: string
  procedureName?: string
  professionalName?: string
  page?: number
  pageSize?: number
  sort?: "dueDate" | "balance" | "patient" | "expected"
  direction?: "asc" | "desc"
}): Promise<ReceivableReport> {
  const period = options.period ?? "month"
  const result = await listContasReceber({
    period,
    from: options.from,
    to: options.to,
    status: options.status,
    search: options.search,
    patientName: options.patientName,
    procedureName: options.procedureName,
    professionalName: options.professionalName,
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 20,
    sort: options.sort ?? "dueDate",
    direction: options.direction ?? "asc",
  })

  return {
    period: {
      preset: result.period.preset,
      from: result.period.from,
      to: result.period.to,
    },
    totalCharged: result.summary.totalExpected,
    totalReceived: result.summary.totalReceived,
    totalPending: result.summary.totalBalance,
    totalOverdue: result.summary.overdueBalance,
    totalUpcoming: result.summary.upcomingBalance,
    totalDueToday: result.summary.dueTodayBalance,
    totalCount: result.summary.totalCount,
    openCount: result.summary.openCount,
    overdueCount: result.summary.overdueCount,
    partialCount: result.summary.partialCount,
    settledCount: result.summary.settledCount,
    cancelledCount: result.summary.cancelledCount,
    rows: result.contas.map((c) => ({
      patientName: c.patientName,
      appointmentCode: c.appointmentCode,
      procedures: proceduresLabel(c.procedures),
      chargedAt: c.chargedAt,
      dueDate: c.dueDate,
      expectedAmount: c.expectedAmount,
      receivedAmount: c.receivedAmount,
      balance: c.balance,
      status: c.status,
      statusLabel: c.statusLabel,
    })),
    pagination: result.pagination,
    meta: { generatedAt: new Date().toISOString() },
  }
}

// ===========================================================================
// RELATÓRIO POR PROCEDIMENTO
// ===========================================================================
// Deriva dos atendimentos do período (fonte: `appointment_procedures` —
// snapshot HISTÓRICO). O valor cobrado é o snapshot; o recebido é rateado
// proporcionalmente aos pagamentos efetivados do atendimento.
//
// IMPORTANTE:
//   * o preço ATUAL do catálogo (`procedures.default_price`) NUNCA é usado
//     para recalcular valor histórico;
//   * "planejado" NÃO é receita — só atendimentos não cancelados entram;
//   * múltiplas linhas do mesmo procedimento são somadas preservando o nome
//     do snapshot de cada atendimento.

interface ProcedureAccumulator {
  name: string
  quantity: number
  chargedCents: number
  receivedCents: number
}

export async function getProcedureReport(options: {
  period?: string
  from?: string
  to?: string
}): Promise<ProcedureReport> {
  const period = options.period ?? "month"
  // Reutiliza a janela de período canônica do fluxo para delimitar os
  // atendimentos do período (mesma convenção de data do restante do módulo).
  const cash = await listCashFlow({
    period,
    from: options.from,
    to: options.to,
    page: 1,
    pageSize: 1,
  })
  const start = new Date(cash.period.from)
  const end = new Date(cash.period.to)

  const appointments = await prisma.appointment.findMany({
    where: {
      appointmentDate: { gte: start, lte: end },
      status: { notIn: ["cancelled", "no_show"] },
    },
    select: {
      id: true,
      totalAmount: true,
      procedures: {
        select: { procedureNameSnapshot: true, quantity: true, totalPrice: true },
      },
      payments: { select: { amount: true, status: true } },
    },
  })

  const map = new Map<string, ProcedureAccumulator>()

  for (const appt of appointments) {
    const procedures = appt.procedures
    const proceduresCents = procedures.reduce((s, p) => s + toCents(p.totalPrice), 0)
    const expectedCents =
      appt.totalAmount != null ? toCents(appt.totalAmount) : proceduresCents
    const receivedCents = appt.payments
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + toCents(p.amount), 0)

    for (const p of procedures) {
      const key = p.procedureNameSnapshot
      const entry = map.get(key) ?? {
        name: p.procedureNameSnapshot,
        quantity: 0,
        chargedCents: 0,
        receivedCents: 0,
      }
      const procCents = toCents(p.totalPrice)
      entry.quantity += p.quantity
      entry.chargedCents += procCents
      // Rateio do recebido proporcional ao peso do procedimento no previsto.
      if (expectedCents > 0 && receivedCents > 0) {
        entry.receivedCents += Math.round((receivedCents * procCents) / expectedCents)
      }
      map.set(key, entry)
    }
  }

  const totalChargedCents = Array.from(map.values()).reduce(
    (s, v) => s + v.chargedCents,
    0
  )
  const totalReceivedCents = Array.from(map.values()).reduce(
    (s, v) => s + v.receivedCents,
    0
  )
  const totalQuantity = Array.from(map.values()).reduce((s, v) => s + v.quantity, 0)

  const rows: ProcedureReportRow[] = Array.from(map.values())
    .map((v) => {
      const pendingCents = Math.max(v.chargedCents - v.receivedCents, 0)
      return {
        name: v.name,
        quantity: v.quantity,
        chargedAmount: fromCents(v.chargedCents),
        receivedAmount: fromCents(v.receivedCents),
        pendingAmount: fromCents(pendingCents),
        shareOfReceivedPercent: sharePercent(v.receivedCents, totalReceivedCents),
      }
    })
    .sort((a, b) => b.receivedAmount - a.receivedAmount)

  return {
    period: { preset: cash.period.preset, from: cash.period.from, to: cash.period.to },
    totalCharged: fromCents(totalChargedCents),
    totalReceived: fromCents(totalReceivedCents),
    totalPending: fromCents(Math.max(totalChargedCents - totalReceivedCents, 0)),
    totalQuantity,
    rows,
    meta: { generatedAt: new Date().toISOString() },
  }
}

// ===========================================================================
// RELATÓRIO POR FORMA DE PAGAMENTO
// ===========================================================================
// Reutiliza `listCashFlow` -> `byMethod` (Financeiro 5). NÃO cria novo enum: os
// métodos são os de `payments.payment_method`.

export async function getPaymentMethodReport(options: {
  period?: string
  from?: string
  to?: string
  professionalName?: string
  search?: string
}): Promise<PaymentMethodReport> {
  const period = options.period ?? "month"
  const cash = await listCashFlow({
    period,
    from: options.from,
    to: options.to,
    type: "INCOME",
    professionalName: options.professionalName,
    search: options.search,
    page: 1,
    pageSize: 1,
  })

  const totalCents = toCents(cash.totals.totalIncome)

  const rows: PaymentMethodReportRow[] = cash.byMethod
    .map((m) => ({
      method: m.method,
      label: m.label,
      count: m.count,
      amount: m.amount,
      sharePercent: sharePercent(toCents(m.amount), totalCents),
    }))
    .sort((a, b) => b.amount - a.amount)

  return {
    period: { preset: cash.period.preset, from: cash.period.from, to: cash.period.to },
    totalReceived: cash.totals.totalIncome,
    totalCount: cash.totals.incomeCount,
    rows,
    meta: { generatedAt: new Date().toISOString() },
  }
}

// ===========================================================================
// VISÃO GERAL DOS RELATÓRIOS (dashboard + gráficos)
// ===========================================================================
// Consolida o resumo + as séries dos 5 gráficos exigidos, TODOS com dados
// reais. Não há dado fake: quando não houver movimentação, as séries vêm
// vazias e a UI mostra estado vazio.

export async function getReportsOverview(options: {
  period?: string
  from?: string
  to?: string
}): Promise<ReportsOverview> {
  const period = options.period ?? "month"

  // As saídas por categoria já vêm consolidadas do fluxo de caixa
  // (`cash.byCategory`), então o relatório de despesas não é necessário aqui.
  const [summary, cash, income] = await Promise.all([
    getFinancialSummary({ period, from: options.from, to: options.to }),
    listCashFlow({
      period,
      from: options.from,
      to: options.to,
      page: 1,
      pageSize: 100,
      sort: "date",
      direction: "asc",
    }),
    getIncomeReport({ period, from: options.from, to: options.to, page: 1, pageSize: 100 }),
  ])

  // Gráfico 1: entradas x saídas por período (série já consolidada do caixa).
  const incomeVsExpense = cash.series.points.map((p) => ({
    key: p.key,
    label: p.label,
    income: p.income,
    expense: p.expense,
  }))

  // Gráfico 2: receitas por forma de pagamento.
  const incomeByMethod = cash.byMethod.map((m) => ({
    key: m.method,
    label: m.label,
    amount: m.amount,
    sharePercent: m.sharePercent,
  }))

  // Gráfico 3: receitas por procedimento (top procedimentos por recebido).
  const incomeByProcedure = income.byProcedure.slice(0, 10).map((p) => ({
    key: p.key,
    label: p.label,
    amount: p.amount,
    sharePercent: p.sharePercent,
  }))

  // Gráfico 4: despesas por categoria.
  const expenseByCategory = cash.byCategory.map((c) => ({
    key: c.categoryId,
    label: c.name,
    amount: c.amount,
    sharePercent: c.sharePercent,
  }))

  // Gráfico 5: evolução do saldo acumulado (derivada da série do caixa).
  const balanceEvolution = cash.series.points.reduce<
    { key: string; label: string; balance: number }[]
  >((acc, p) => {
    const previous = acc.length > 0 ? acc[acc.length - 1].balance : cash.totals.openingBalance
    acc.push({
      key: p.key,
      label: p.label,
      balance: roundMoney(previous + p.net),
    })
    return acc
  }, [])

  return {
    period: { preset: cash.period.preset, from: cash.period.from, to: cash.period.to },
    summary,
    charts: {
      incomeVsExpense,
      incomeByMethod,
      incomeByProcedure,
      expenseByCategory,
      balanceEvolution,
    },
    meta: { generatedAt: new Date().toISOString() },
  }
}

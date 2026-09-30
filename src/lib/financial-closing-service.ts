// ===========================================================================
// SERVIÇO DE FECHAMENTO FINANCEIRO — módulo Financeiro (Financeiro 6).
// ===========================================================================
//
// O QUE ESTE SERVIÇO É
//
// A implementação do FECHAMENTO FINANCEIRO: a confirmação de que um período
// foi revisado e encerrado, com snapshot dos totais, auditoria e reabertura.
//
// ---------------------------------------------------------------------------
// REGRA MAIS IMPORTANTE: NÃO CRIAR UMA SEGUNDA FONTE DE VERDADE
// ---------------------------------------------------------------------------
//
// Este serviço NÃO calcula números financeiros. Ele LÊ os números dos serviços
// canônicos (`listCashFlow`, `listContasReceber`, `listDespesas`) e apenas:
//   1. valida se o período pode ser fechado;
//   2. CONGELA esses números num snapshot (financial_closings);
//   3. registra a ação na trilha de auditoria (financial_closing_logs).
//
// Os pagamentos e despesas continuam existindo SOMENTE em `payments` e
// `expense_payments`. O fechamento não duplica movimentação: ele referencia o
// período.
//
// ---------------------------------------------------------------------------
// EFEITO DO FECHAMENTO SOBRE ALTERAÇÕES RETROATIVAS
// ---------------------------------------------------------------------------
// O fechamento NÃO apaga nem bloqueia dados fisicamente (o sistema preserva o
// histórico e não faz exclusão destrutiva). O que ele faz:
//
//   * impede NOVOS fechamentos que se sobreponham a um fechamento ATIVO;
//   * congela um snapshot que permite DETECTAR alterações retroativas: ao
//     consultar um fechamento, recalculamos os números atuais e comparamos com
//     o snapshot, sinalizando divergências (`compareSnapshot`);
//   * exige motivo para REABRIR, registrando tudo em auditoria.
//
// Assim, "alteração retroativa indevida" é detectada e visível, sem nunca
// destruir informação.
//
// ---------------------------------------------------------------------------
// IDENTIDADE
// ---------------------------------------------------------------------------
// Ator é ATRIBUIÇÃO textual (`actorName`), não autenticação — mesma convenção
// do restante do Financeiro (`normalizeActorName`).

import { prisma } from "@/lib/prisma"
import { roundMoney } from "@/lib/financial-domain"
import {
  compareSnapshot,
  hasBlockingChecks,
  snapshotFromRow,
  validateClosingPeriod,
  type ClosingSnapshot,
  type ClosingValidationCheck,
  type SnapshotComparison,
} from "@/lib/financial-closing-domain"
import { listCashFlow } from "@/lib/financial-cash-flow-service"
import { getFinancialSummary } from "@/lib/financial-reports-service"
import { listContasReceber } from "@/lib/financial-contas-receber-service"
import { listDespesas } from "@/lib/financial-expense-service"
import { normalizeActorName, financialError } from "@/lib/financial-service"
import type { FinancialActor, FinancialError } from "@/lib/financial-service"

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface ClosingListItem {
  id: string
  periodStart: string
  periodEnd: string
  /** "YYYY-MM" do mês dominante do período (para agrupamento na UI). */
  periodKey: string
  status: string
  statusLabel: string
  snapshot: ClosingSnapshot
  closedAt: string
  closedByName: string | null
  reopenedAt: string | null
  reopenedByName: string | null
  reopenReason: string | null
  notes: string | null
  /** Há divergência entre snapshot e os números atuais. */
  hasChanges?: boolean
}

export interface ClosingDetail extends ClosingListItem {
  logs: {
    id: string
    event: string
    eventLabel: string
    description: string
    reason: string | null
    performedByName: string | null
    createdAt: string
  }[]
  /** Comparação snapshot x valores atuais (auditoria de alterações). */
  comparison: SnapshotComparison
  /** Validação atual do período (útil para saber se pode reabrir/fechar). */
  checks: ClosingValidationCheck[]
}

export interface ValidateClosingResult {
  canClose: boolean
  checks: ClosingValidationCheck[]
  preview: {
    filter: { period: string; from?: string; to?: string }
    income: number
    expense: number
    periodBalance: number
    receivable: number
    payable: number
    result: number
  }
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Converte "YYYY-MM-DD" para Date no fuso LOCAL (início do dia). */
function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Último instante do dia local. */
function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

/** Chave "YYYY-MM" do período (usa o mês inicial). */
function periodKeyOf(start: Date): string {
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`
}

/**
 * Constrói o snapshot do período a partir dos SERVIÇOS canônicos (nunca de uma
 * segunda fonte). Usa o período custom [from, to] para delimitar os números.
 */
async function buildSnapshot(from: string, to: string): Promise<ClosingSnapshot> {
  const filter = { period: "custom", from, to }

  const [summary, receivable, expenses] = await Promise.all([
    getFinancialSummary(filter),
    listContasReceber({ ...filter, page: 1, pageSize: 1 }),
    listDespesas({ ...filter, page: 1, pageSize: 1 }),
  ])

  const income = summary.result.income
  const expense = summary.result.expense

  return {
    income,
    expense,
    periodBalance: roundMoney(income - expense),
    openingBalance: 0, // preenchido a seguir pelo fluxo (requer período relativo)
    closingBalance: 0,
    receivable: receivable.summary.totalBalance,
    payable: roundMoney(expenses.summary.totalExpenses - expenses.summary.totalPaid),
    result: roundMoney(income - expense),
    incomeCount: summary.cards.find((c) => c.key === "income")?.secondaryValue ?? 0,
    expenseCount: summary.cards.find((c) => c.key === "expense")?.secondaryValue ?? 0,
  }
}

/** Mapeia uma linha de fechamento para o tipo público (sem comparação). */
function toListItem(row: {
  id: string
  periodStart: Date
  periodEnd: Date
  status: string
  snapshotIncome: number
  snapshotExpense: number
  snapshotPeriodBalance: number
  snapshotOpeningBalance: number
  snapshotClosingBalance: number
  snapshotReceivable: number
  snapshotPayable: number
  snapshotResult: number
  snapshotIncomeCount: number
  snapshotExpenseCount: number
  closedAt: Date
  closedByName: string | null
  reopenedAt: Date | null
  reopenedByName: string | null
  reopenReason: string | null
  notes: string | null
}): ClosingListItem {
  return {
    id: row.id,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    periodKey: periodKeyOf(row.periodStart),
    status: row.status,
    statusLabel: row.status === "reopened" ? "Reaberto" : "Fechado",
    snapshot: snapshotFromRow(row),
    closedAt: row.closedAt.toISOString(),
    closedByName: row.closedByName,
    reopenedAt: row.reopenedAt ? row.reopenedAt.toISOString() : null,
    reopenedByName: row.reopenedByName,
    reopenReason: row.reopenReason,
    notes: row.notes,
  }
}

const CLOSING_SELECT = {
  id: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  snapshotIncome: true,
  snapshotExpense: true,
  snapshotPeriodBalance: true,
  snapshotOpeningBalance: true,
  snapshotClosingBalance: true,
  snapshotReceivable: true,
  snapshotPayable: true,
  snapshotResult: true,
  snapshotIncomeCount: true,
  snapshotExpenseCount: true,
  closedAt: true,
  closedByName: true,
  reopenedAt: true,
  reopenedByName: true,
  reopenReason: true,
  notes: true,
} as const

// ---------------------------------------------------------------------------
// VALIDAÇÃO PRÉ-FECHAMENTO
// ---------------------------------------------------------------------------

export async function validateClosing(
  from: string,
  to: string,
  reference: Date = new Date()
): Promise<ValidateClosingResult | FinancialError> {
  const start = parseLocalDate(from)
  const end = parseLocalDate(to)
  if (!start || !end) {
    return financialError("INVALID_INPUT", "Datas do período são inválidas.", 400)
  }
  const endInclusive = endOfLocalDay(end)

  // Sobreposição com fechamentos ativos.
  const overlapping = await prisma.financialClosing.count({
    where: {
      status: "closed",
      periodStart: { lte: endInclusive },
      periodEnd: { gte: start },
    },
  })

  // Pendências (para os avisos) + movimentações efetivadas.
  const filter = { period: "custom", from, to }
  const [receivable, expenses, summary] = await Promise.all([
    listContasReceber({ ...filter, page: 1, pageSize: 1 }),
    listDespesas({ ...filter, page: 1, pageSize: 1 }),
    getFinancialSummary(filter),
  ])

  const openReceivableCount =
    receivable.summary.openCount + receivable.summary.overdueCount + receivable.summary.partialCount
  const openPayableCount = expenses.summary.pendingCount
  const movementCount =
    (summary.cards.find((c) => c.key === "income")?.secondaryValue ?? 0) +
    (summary.cards.find((c) => c.key === "expense")?.secondaryValue ?? 0)

  const checks = validateClosingPeriod({
    start,
    end: endInclusive,
    overlappingActiveClosings: overlapping,
    openReceivableCount,
    openPayableCount,
    movementCount,
    reference,
  })

  return {
    canClose: !hasBlockingChecks(checks),
    checks,
    preview: {
      filter,
      income: summary.result.income,
      expense: summary.result.expense,
      periodBalance: roundMoney(summary.result.income - summary.result.expense),
      receivable: receivable.summary.totalBalance,
      payable: roundMoney(expenses.summary.totalExpenses - expenses.summary.totalPaid),
      result: roundMoney(summary.result.income - summary.result.expense),
    },
  }
}

// ---------------------------------------------------------------------------
// FECHAMENTO
// ---------------------------------------------------------------------------

export interface ClosePeriodInput {
  from: string
  to: string
  notes?: string | null
  actor?: FinancialActor
}

export async function closePeriod(
  input: ClosePeriodInput
): Promise<ClosingDetail | FinancialError> {
  const validation = await validateClosing(input.from, input.to)
  if ("error" in validation) return validation
  if (!validation.canClose) {
    const blocking = validation.checks.filter((c) => c.blocking)
    return financialError(
      "INVALID_STATE",
      blocking.map((c) => c.description).join(" ") || "Período não pode ser fechado.",
      409
    )
  }

  const start = parseLocalDate(input.from)!
  const end = endOfLocalDay(parseLocalDate(input.to)!)
  const actorName = normalizeActorName(input.actor?.name)

  // Snapshot dos números REAIS do período (serviços canônicos).
  const snapshot = await buildSnapshot(input.from, input.to)

  // Saldo acumulado anterior/final vêm do fluxo de caixa (fonte única).
  const cash = await listCashFlowForBalance(input.from, input.to)
  snapshot.openingBalance = cash.openingBalance
  snapshot.closingBalance = cash.closingBalance

  const created = await prisma.$transaction(async (tx) => {
    const closing = await tx.financialClosing.create({
      data: {
        periodStart: start,
        periodEnd: end,
        status: "closed",
        snapshotIncome: snapshot.income,
        snapshotExpense: snapshot.expense,
        snapshotPeriodBalance: snapshot.periodBalance,
        snapshotOpeningBalance: snapshot.openingBalance,
        snapshotClosingBalance: snapshot.closingBalance,
        snapshotReceivable: snapshot.receivable,
        snapshotPayable: snapshot.payable,
        snapshotResult: snapshot.result,
        snapshotIncomeCount: snapshot.incomeCount,
        snapshotExpenseCount: snapshot.expenseCount,
        notes: input.notes?.trim() || null,
        closedById: input.actor?.userId ?? null,
        closedByName: actorName,
      },
      select: CLOSING_SELECT,
    })

    await tx.financialClosingLog.create({
      data: {
        closingId: closing.id,
        event: "closed",
        description: "Período financeiro fechado.",
        newValue: JSON.stringify(snapshot),
        performedById: input.actor?.userId ?? null,
        performedByName: actorName,
      },
    })

    return closing
  })

  return buildDetail(created)
}

/** Lê saldo acumulado do período sem duplicar a regra de caixa. */
async function listCashFlowForBalance(
  from: string,
  to: string
): Promise<{ openingBalance: number; closingBalance: number }> {
  const cash = await listCashFlow({
    period: "custom",
    from,
    to,
    page: 1,
    pageSize: 1,
  })
  return {
    openingBalance: cash.totals.openingBalance,
    closingBalance: cash.totals.closingBalance,
  }
}

// ---------------------------------------------------------------------------
// REABERTURA
// ---------------------------------------------------------------------------

export async function reopenPeriod(
  closingId: string,
  reason: string,
  actor: FinancialActor = { userId: null, name: "" }
): Promise<ClosingDetail | FinancialError> {
  const trimmedReason = (reason ?? "").trim()
  if (trimmedReason.length < 3) {
    return financialError(
      "INVALID_INPUT",
      "O motivo da reabertura é obrigatório.",
      400
    )
  }

  const closing = await prisma.financialClosing.findUnique({
    where: { id: closingId },
    select: { id: true, status: true, reopenedAt: true },
  })
  if (!closing) {
    return financialError("EXPENSE_NOT_FOUND", "Fechamento não encontrado.", 404)
  }
  if (closing.status !== "closed") {
    return financialError("INVALID_STATE", "Este período já está reaberto.", 409)
  }

  const actorName = normalizeActorName(actor?.name)
  const now = new Date()

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.financialClosing.update({
      where: { id: closingId },
      data: {
        status: "reopened",
        reopenedAt: now,
        reopenedById: actor?.userId ?? null,
        reopenedByName: actorName,
        reopenReason: trimmedReason,
      },
      select: CLOSING_SELECT,
    })

    await tx.financialClosingLog.create({
      data: {
        closingId,
        event: "reopened",
        description: `Período reaberto. Motivo: ${trimmedReason}`,
        reason: trimmedReason,
        oldValue: JSON.stringify(row.snapshotIncome),
        performedById: actor?.userId ?? null,
        performedByName: actorName,
      },
    })

    return row
  })

  return buildDetail(updated)
}

// ---------------------------------------------------------------------------
// DETALHE / COMPARAÇÃO / HISTÓRICO
// ---------------------------------------------------------------------------

async function buildDetail(row: {
  id: string
  periodStart: Date
  periodEnd: Date
  status: string
  snapshotIncome: number
  snapshotExpense: number
  snapshotPeriodBalance: number
  snapshotOpeningBalance: number
  snapshotClosingBalance: number
  snapshotReceivable: number
  snapshotPayable: number
  snapshotResult: number
  snapshotIncomeCount: number
  snapshotExpenseCount: number
  closedAt: Date
  closedByName: string | null
  reopenedAt: Date | null
  reopenedByName: string | null
  reopenReason: string | null
  notes: string | null
}): Promise<ClosingDetail> {
  const base = toListItem(row)

  const logs = await prisma.financialClosingLog.findMany({
    where: { closingId: row.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      event: true,
      description: true,
      reason: true,
      performedByName: true,
      createdAt: true,
    },
  })

  // Comparação: snapshot x números ATUAIS recalculados dos serviços.
  const from = toDateOnly(row.periodStart)
  const to = toDateOnly(row.periodEnd)
  const current = await buildSnapshot(from, to)
  const balance = await listCashFlowForBalance(from, to)
  current.openingBalance = balance.openingBalance
  current.closingBalance = balance.closingBalance

  const snapshot = snapshotFromRow(row)
  const comparison = compareSnapshot(snapshot, current)

  const validation = await validateClosing(from, to)

  return {
    ...base,
    hasChanges: comparison.hasChanges,
    logs: logs.map((l) => ({
      id: l.id,
      event: l.event,
      eventLabel: l.event === "reopened" ? "Período reaberto" : "Período fechado",
      description: l.description,
      reason: l.reason,
      performedByName: l.performedByName,
      createdAt: l.createdAt.toISOString(),
    })),
    comparison,
    checks: "checks" in validation ? validation.checks : [],
  }
}

function toDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`
}

export async function getClosingDetail(id: string): Promise<ClosingDetail | null> {
  const row = await prisma.financialClosing.findUnique({
    where: { id },
    select: CLOSING_SELECT,
  })
  if (!row) return null
  return buildDetail(row)
}

export async function listClosings(options: {
  page?: number
  pageSize?: number
  status?: string
} = {}): Promise<{
  closings: ClosingListItem[]
  pagination: {
    page: number
    pageSize: number
    totalPages: number
    totalCount: number
    hasPrevious: boolean
    hasNext: boolean
  }
}> {
  const page = Math.max(options.page ?? 1, 1)
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100)

  const where = {
    ...(options.status ? { status: options.status } : {}),
  }

  const [total, rows] = await Promise.all([
    prisma.financialClosing.count({ where }),
    prisma.financialClosing.findMany({
      where,
      orderBy: [{ periodStart: "desc" }, { closedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: CLOSING_SELECT,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Sinaliza divergência para cada item (detecção de alteração retroativa).
  const items = await Promise.all(
    rows.map(async (row) => {
      const item = toListItem(row)
      const from = toDateOnly(row.periodStart)
      const to = toDateOnly(row.periodEnd)
      const current = await buildSnapshot(from, to)
      const balance = await listCashFlowForBalance(from, to)
      current.openingBalance = balance.openingBalance
      current.closingBalance = balance.closingBalance
      const comparison = compareSnapshot(snapshotFromRow(row), current)
      return { ...item, hasChanges: comparison.hasChanges }
    })
  )

  const filtered = items

  return {
    closings: filtered,
    pagination: {
      page,
      pageSize,
      totalPages,
      totalCount: total,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  }
}

/** Indica se um período [from, to] está bloqueado por um fechamento ativo. */
export async function isPeriodClosed(from: string, to: string): Promise<boolean> {
  const start = parseLocalDate(from)
  const end = parseLocalDate(to)
  if (!start || !end) return false
  const count = await prisma.financialClosing.count({
    where: {
      status: "closed",
      periodStart: { lte: endOfLocalDay(end) },
      periodEnd: { gte: start },
    },
  })
  return count > 0
}

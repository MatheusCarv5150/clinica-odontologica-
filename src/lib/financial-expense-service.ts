// ===========================================================================
// SERVIÇO DE DESPESAS — módulo Financeiro (Financeiro 4) — IMPLEMENTAÇÃO ÚNICA.
// ===========================================================================
//
// Este é o SERVICE CANÔNICO de Despesas. Não existe outra implementação.
//
// DESPESA ≠ MOVIMENTAÇÃO FINANCEIRA.
//   * `Expense`          → o compromisso/obrigação registrado.
//   * `ExpensePayment`   → pagamento(s) efetivo(s) contra a despesa (parciais).
//   * `ExpenseLog`       → auditoria (criação, edição, pagamento, cancelamento).
//   * `FinancialTransaction` (direction="out") → visão consolidada de caixa.
//
// A movimentação DERIVADA referencia a despesa (`expenseId`). Nada é duplicado:
// a despesa é a fonte, a movimentação é a projeção.
//
// ---------------------------------------------------------------------------
// CONSOLIDAÇÃO ARQUITETURAL (A + B → ÚNICA)
// ---------------------------------------------------------------------------
// Este arquivo nasceu da consolidação de duas implementações paralelas:
//   * BASE  → pagamentos múltiplos, pagamento parcial, status derivado,
//             summary, auditoria, listagem paginada/filtrada (ex-B).
//   * ABSORVIDO → resolução de contexto no servidor (appointmentId/patientId,
//             CONTEXT_MISMATCH), validação de categoria ATIVA, catálogo de
//             categorias padrão, convênios (InsurancePlan) (ex-A).
//
// ---------------------------------------------------------------------------
// REGRAS DE NEGÓCIO
// ---------------------------------------------------------------------------
// STATUS DERIVADO (nunca fonte de verdade isolada):
//   1. CANCELADA — fora de todos os totais
//   2. PAGA      — saldo zero
//   3. VENCIDA   — saldo > 0 e vencimento anterior a hoje
//   4. PARCIAL   — saldo > 0 mas já houve pagamento
//   5. PENDENTE  — saldo > 0, nada pago ainda
//
// PAGAMENTOS: múltiplos, parciais, com histórico. É PROIBIDO pagar acima do
// saldo. A validação é feita DENTRO DE TRANSAÇÃO para resistir a concorrência.
//
// CATEGORIA HISTÓRICA: a despesa guarda `categoryId` no momento da criação.
// Desativar uma categoria impede NOVAS despesas, mas não altera as existentes.
// Categoria nunca é excluída fisicamente (ATIVA/INATIVA).
//
// CANCELAMENTO: despesa nunca é excluída fisicamente. Status vai para
// "cancelled" com data/motivo/responsável.
//
// IDENTIDADE TEXTUAL: `createdByName`, `paidByName`, `cancelledByName` são
// ATRIBUIÇÃO (quem fez), não autenticação. `*ById` fica preparado para uma
// futura autenticação real.
//
// SEGURANÇA: o paciente é SEMPRE resolvido no servidor. Se `appointmentId` for
// informado, o `patientId` vem do atendimento; um `patientId` divergente
// enviado pelo cliente é REJEITADO (CONTEXT_MISMATCH).

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import {
  EXPENSE_KINDS,
  INSURANCE_PLAN_KINDS,
  isExpenseKind,
  isInsurancePlanKind,
  normalizeAmount,
  roundMoney,
  toCents,
  fromCents,
  resolvePeriodRange,
  paymentMethodLabel,
  toDayKey,
} from "@/lib/financial-domain"
import {
  financialError,
  isFinancialError,
  normalizeActorName,
  type FinancialActor,
  type FinancialError,
} from "@/lib/financial-service"

// ---------------------------------------------------------------------------
// Datas "YYYY-MM-DD" no fuso local do servidor
// ---------------------------------------------------------------------------

export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

// ===========================================================================
// STATUS DERIVADO
// ===========================================================================

export const DESPESA_STATUSES = [
  "PENDENTE",
  "PARCIAL",
  "PAGA",
  "VENCIDA",
  "CANCELADA",
] as const

export type DespesaStatus = (typeof DESPESA_STATUSES)[number]

export const DESPESA_STATUS_LABELS: Record<DespesaStatus, string> = {
  PENDENTE: "Pendente",
  PARCIAL: "Parcial",
  PAGA: "Paga",
  VENCIDA: "Vencida",
  CANCELADA: "Cancelada",
}

export function despesaStatusLabel(status: string): string {
  return DESPESA_STATUS_LABELS[status as DespesaStatus] ?? status
}

export const DESPESA_STATUS_COLORS: Record<string, string> = {
  PENDENTE: "bg-amber-100 text-amber-800",
  PARCIAL: "bg-blue-100 text-blue-800",
  PAGA: "bg-green-100 text-green-800",
  VENCIDA: "bg-red-100 text-red-800",
  CANCELADA: "bg-gray-100 text-gray-600",
}

/**
 * Deriva o status da despesa a partir do saldo e vencimento.
 *
 * PRECEDÊNCIA: CANCELADA > PAGA > VENCIDA > PARCIAL > PENDENTE.
 */
export function deriveDespesaStatus(params: {
  cancelled: boolean
  balance: number
  paidAmount: number
  dueDate: Date | string | null
  referenceDate?: Date
}): DespesaStatus {
  if (params.cancelled) return "CANCELADA"
  if (params.balance <= 0) return "PAGA"

  const reference = params.referenceDate ?? new Date()
  const todayKey = toDayKey(reference)

  if (params.dueDate) {
    const due = params.dueDate instanceof Date ? params.dueDate : new Date(params.dueDate)
    if (toDayKey(due) < todayKey) return "VENCIDA"
  }

  if (params.paidAmount > 0) return "PARCIAL"

  return "PENDENTE"
}

// ---------------------------------------------------------------------------
// PAYMENT METHODS (mesmo vocabulário do sistema)
// ---------------------------------------------------------------------------

export const DESPESA_PAYMENT_METHODS = [
  "pix",
  "dinheiro",
  "debito",
  "credito",
  "transferencia",
  "boleto",
  "outros",
] as const

// ===========================================================================
// TIPOS PÚBLICOS
// ===========================================================================

export interface DespesaItem {
  id: string
  description: string
  supplier: string | null
  categoryId: string
  categoryName: string
  categoryKind: string
  amount: number
  paidAmount: number
  balance: number
  status: DespesaStatus
  statusLabel: string
  competenceDate: string
  dueDate: string | null
  paidAt: string | null
  lastPaymentDate: string | null
  paymentMethod: string | null
  paymentMethodLabel: string
  notes: string | null
  documentNumber: string | null
  isRecurring: boolean
  createdByName: string | null
  paidByName: string | null
  cancelledAt: string | null
  cancelledByName: string | null
  cancelReason: string | null
}

export interface DespesaPaymentEntry {
  id: string
  amount: number
  paymentMethod: string
  paymentMethodLabel: string
  paidAt: string
  notes: string | null
  paidByName: string | null
  createdAt: string
}

export interface DespesaLogEntry {
  id: string
  event: string
  description: string
  oldValue: string | null
  newValue: string | null
  performedByName: string | null
  createdAt: string
}

export interface DespesaDetail {
  id: string
  description: string
  supplier: string | null
  categoryId: string
  categoryName: string
  categoryKind: string
  amount: number
  paidAmount: number
  balance: number
  paidPercent: number
  status: DespesaStatus
  statusLabel: string
  competenceDate: string
  dueDate: string | null
  paymentMethod: string | null
  paymentMethodLabel: string
  notes: string | null
  documentNumber: string | null
  isRecurring: boolean
  createdByName: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
  cancelledByName: string | null
  cancelReason: string | null
  payments: DespesaPaymentEntry[]
  logs: DespesaLogEntry[]
}

export interface DespesasSummary {
  totalExpenses: number
  totalPaid: number
  totalPending: number
  totalOverdue: number
  dueToday: number
  upcoming: number
  totalCount: number
  paidCount: number
  pendingCount: number
  overdueCount: number
  dueTodayCount: number
  cancelledCount: number
}

export interface ListDespesasOptions {
  period?: string
  from?: string
  to?: string
  status?: string
  categoryId?: string
  paymentMethod?: string
  supplier?: string
  isRecurring?: boolean
  search?: string
  sort?: "dueDate" | "amount" | "description" | "supplier" | "competenceDate"
  direction?: "asc" | "desc"
  page?: number
  pageSize?: number
}

export interface ListDespesasResult {
  despesas: DespesaItem[]
  summary: DespesasSummary
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
}

// ---------------------------------------------------------------------------
// LOG DE AUDITORIA
// ---------------------------------------------------------------------------

async function addLog(
  tx: Prisma.TransactionClient,
  expenseId: string,
  event: string,
  description: string,
  actor: FinancialActor,
  extras?: { oldValue?: string; newValue?: string }
) {
  await tx.expenseLog.create({
    data: {
      expenseId,
      event,
      description,
      oldValue: extras?.oldValue ?? null,
      newValue: extras?.newValue ?? null,
      performedById: actor?.userId ?? null,
      performedByName: normalizeActorName(actor?.name),
    },
  })
}

// ===========================================================================
// CATEGORIAS DE DESPESA (fonte única)
// ===========================================================================

/** Categorias iniciais (dados de REFERÊNCIA, não financeiros). */
export const DEFAULT_EXPENSE_CATEGORIES: { name: string; kind: string }[] = [
  { name: "Materiais odontológicos", kind: "material" },
  { name: "Laboratório protético", kind: "operacional" },
  { name: "Medicamentos", kind: "material" },
  { name: "Equipamentos", kind: "material" },
  { name: "Instrumentais e equipamentos", kind: "material" },
  { name: "Manutenção", kind: "operacional" },
  { name: "Aluguel e condomínio", kind: "infraestrutura" },
  { name: "Energia elétrica", kind: "infraestrutura" },
  { name: "Água", kind: "infraestrutura" },
  { name: "Internet e telefone", kind: "infraestrutura" },
  { name: "Sistemas e softwares", kind: "operacional" },
  { name: "Contabilidade", kind: "operacional" },
  { name: "Salários e pró-labore", kind: "pessoal" },
  { name: "Serviços terceirizados", kind: "operacional" },
  { name: "Marketing e divulgação", kind: "marketing" },
  { name: "Impostos e taxas", kind: "impostos" },
  { name: "Limpeza e higiene", kind: "operacional" },
  { name: "Material de escritório", kind: "operacional" },
  { name: "Transporte", kind: "operacional" },
  { name: "Outros", kind: "outros" },
]

/**
 * Garante a existência das categorias padrão (idempotente por `name`).
 * Não cria DESPESA nenhuma — só dados de referência.
 */
export async function ensureDefaultExpenseCategories(): Promise<number> {
  let created = 0
  for (const category of DEFAULT_EXPENSE_CATEGORIES) {
    const existing = await prisma.expenseCategory.findUnique({
      where: { name: category.name },
      select: { id: true },
    })
    if (existing) continue
    await prisma.expenseCategory.create({
      data: { name: category.name, kind: category.kind, system: true },
    })
    created++
  }
  return created
}

export async function listExpenseCategories(options: { includeInactive?: boolean } = {}) {
  return prisma.expenseCategory.findMany({
    where: options.includeInactive ? {} : { active: true },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      system: true,
      active: true,
    },
  })
}

export async function createExpenseCategory(input: {
  name: string
  kind: string
}): Promise<{ id: string } | FinancialError> {
  const name = (input.name ?? "").trim()
  if (name.length < 2) {
    return financialError("INVALID_INPUT", "Nome da categoria é obrigatório.", 400)
  }
  if (!input.kind || !isExpenseKind(input.kind)) {
    return financialError(
      "INVALID_INPUT",
      `Tipo inválido. Use um de: ${EXPENSE_KINDS.join(", ")}.`,
      400
    )
  }

  const existing = await prisma.expenseCategory.findUnique({
    where: { name },
    select: { id: true },
  })
  if (existing) {
    return financialError("INVALID_INPUT", "Já existe uma categoria com esse nome.", 409)
  }

  return prisma.expenseCategory.create({
    data: { name, kind: input.kind, system: false },
    select: { id: true },
  })
}

/**
 * Ativa/desativa uma categoria. Categorias NUNCA são excluídas fisicamente:
 * despesas antigas preservam o vínculo histórico.
 */
export async function setExpenseCategoryActive(
  categoryId: string,
  active: boolean
): Promise<{ id: string; active: boolean } | FinancialError> {
  const category = await prisma.expenseCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  })
  if (!category) {
    return financialError("CATEGORY_NOT_FOUND", "Categoria não encontrada.", 404)
  }
  return prisma.expenseCategory.update({
    where: { id: categoryId },
    data: { active },
    select: { id: true, active: true },
  })
}

// ===========================================================================
// CRIAÇÃO DE DESPESA
// ===========================================================================

export interface CreateDespesaInput {
  categoryId: string
  description: string
  supplier?: string | null
  amount: number
  competenceDate: string
  dueDate?: string | null
  notes?: string | null
  paymentMethod?: string | null
  documentNumber?: string | null
  isRecurring?: boolean
  /** Vincular a um atendimento (opcional). Paciente é resolvido no servidor. */
  appointmentId?: string | null
  /** Paciente direto (opcional). Validado se houver appointmentId. */
  patientId?: string | null
  /** Se true, cria já quitada (registra pagamento e movimentação). */
  markAsPaid?: boolean
}

/** Alias retrocompatível: a implementação A chamava isto de `createExpense`. */
export type CreateExpenseInput = CreateDespesaInput

export async function createDespesa(
  input: CreateDespesaInput,
  actor: FinancialActor
): Promise<{ id: string } | FinancialError> {
  if (!input.categoryId) {
    return financialError("INVALID_INPUT", "Categoria é obrigatória.", 400)
  }
  const description = (input.description ?? "").trim()
  if (description.length < 2) {
    return financialError("INVALID_INPUT", "Descrição deve ter no mínimo 2 caracteres.", 400)
  }

  const amount = normalizeAmount(input.amount)
  if (toCents(amount) <= 0) {
    return financialError("INVALID_INPUT", "Valor deve ser maior que zero.", 400)
  }

  const competenceDate = parseDateOnly(input.competenceDate)
  if (!competenceDate) {
    return financialError("INVALID_INPUT", "Data da despesa inválida. Use YYYY-MM-DD.", 400)
  }

  const dueDate = parseDateOnly(input.dueDate)
  if (input.dueDate && !dueDate) {
    return financialError("INVALID_INPUT", "Data de vencimento inválida.", 400)
  }

  const category = await prisma.expenseCategory.findUnique({
    where: { id: input.categoryId },
    select: { id: true, active: true },
  })
  if (!category) {
    return financialError("CATEGORY_NOT_FOUND", "Categoria não encontrada.", 404)
  }
  if (!category.active) {
    return financialError("INVALID_INPUT", "Categoria inativa não pode ser usada.", 400)
  }

  // --- Contexto resolvido NO SERVIDOR (absorvido da implementação A) ---
  let appointmentId: string | null = null
  let patientId: string | null = null

  if (input.appointmentId) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: input.appointmentId },
      select: { id: true, patientId: true },
    })
    if (!appointment) {
      return financialError("APPOINTMENT_NOT_FOUND", "Atendimento não encontrado.", 404)
    }
    // O paciente do atendimento é a verdade. Divergência é rejeitada.
    if (input.patientId && input.patientId !== appointment.patientId) {
      return financialError(
        "CONTEXT_MISMATCH",
        "O paciente informado não corresponde ao atendimento.",
        409
      )
    }
    appointmentId = appointment.id
    patientId = appointment.patientId
  } else if (input.patientId) {
    const patient = await prisma.patient.findUnique({
      where: { id: input.patientId },
      select: { id: true },
    })
    if (!patient) {
      return financialError("PATIENT_NOT_FOUND", "Paciente não encontrado.", 404)
    }
    patientId = patient.id
  }

  const actorName = normalizeActorName(actor?.name)
  const method = input.paymentMethod?.trim() || null
  const now = new Date()
  const markAsPaid = input.markAsPaid === true

  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        categoryId: category.id,
        description,
        supplier: input.supplier?.trim() || null,
        amount,
        status: markAsPaid ? "paid" : "pending",
        competenceDate,
        dueDate,
        paidAt: markAsPaid ? now : null,
        paymentMethod: markAsPaid ? method : null,
        notes: input.notes?.trim() || null,
        appointmentId,
        patientId,
        createdById: actor?.userId ?? null,
        createdByName: actorName,
        paidById: markAsPaid ? actor?.userId ?? null : null,
        paidByName: markAsPaid ? actorName : null,
      },
      select: { id: true },
    })

    // Se marcou como paga, cria o registro de pagamento efetivo.
    if (markAsPaid) {
      await tx.expensePayment.create({
        data: {
          expenseId: expense.id,
          amount,
          paymentMethod: method ?? "outros",
          paidAt: now,
          paidById: actor?.userId ?? null,
          paidByName: actorName,
        },
      })
    }

    // Movimentação DERIVADA da despesa (nunca duplicada).
    await tx.financialTransaction.create({
      data: {
        direction: "out",
        amount,
        status: markAsPaid ? "settled" : "pending",
        competenceDate,
        settledAt: markAsPaid ? now : null,
        description,
        expenseId: expense.id,
        patientId,
        appointmentId,
        paymentMethod: markAsPaid ? method : null,
        createdById: actor?.userId ?? null,
        createdByName: actorName,
      },
    })

    await addLog(
      tx,
      expense.id,
      "created",
      `Despesa criada: ${description} — ${formatCurrency(amount)}`,
      actor
    )

    return { id: expense.id }
  })
}

// ===========================================================================
// ATUALIZAÇÃO
// ===========================================================================

export interface UpdateDespesaInput {
  description?: string
  supplier?: string | null
  amount?: number
  competenceDate?: string
  dueDate?: string | null
  notes?: string | null
  documentNumber?: string | null
  isRecurring?: boolean
}

/** Alias retrocompatível: a implementação A chamava isto de `updateExpense`. */
export type UpdateExpenseInput = UpdateDespesaInput

export async function updateDespesa(
  expenseId: string,
  input: UpdateDespesaInput,
  actor: FinancialActor = { userId: null, name: "" }
): Promise<{ id: string } | FinancialError> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      status: true,
      amount: true,
      description: true,
      competenceDate: true,
      dueDate: true,
    },
  })
  if (!expense) {
    return financialError("EXPENSE_NOT_FOUND", "Despesa não encontrada.", 404)
  }
  if (expense.status === "cancelled") {
    return financialError("INVALID_STATE", "Despesa cancelada não pode ser editada.", 409)
  }

  // Despesa QUITADA é imutável: qualquer alteração de valor/competência
  // reescreveria a movimentação efetivada e corromperia o caixa. Correções
  // posteriores devem ser feitas por cancelamento + novo lançamento.
  if (expense.status === "paid") {
    return financialError("INVALID_STATE", "Despesa quitada não pode ser editada.", 409)
  }

  const data: Record<string, unknown> = {}
  const changes: string[] = []
  let newAmount: number | null = null

  if (input.description !== undefined) {
    const desc = input.description.trim()
    if (desc.length < 2) return financialError("INVALID_INPUT", "Descrição inválida.", 400)
    changes.push(`descrição: "${expense.description}" → "${desc}"`)
    data.description = desc
  }

  if (input.supplier !== undefined) {
    data.supplier = input.supplier?.trim() || null
    changes.push("fornecedor alterado")
  }

  if (input.amount !== undefined) {
    const amt = normalizeAmount(input.amount)
    if (toCents(amt) <= 0) {
      return financialError("INVALID_INPUT", "Valor deve ser maior que zero.", 400)
    }
    newAmount = amt
    changes.push(`valor: ${formatCurrency(expense.amount)} → ${formatCurrency(amt)}`)
    data.amount = amt
  }

  if (input.competenceDate !== undefined) {
    const cd = parseDateOnly(input.competenceDate)
    if (!cd) return financialError("INVALID_INPUT", "Data inválida.", 400)
    data.competenceDate = cd
    changes.push("competência alterada")
  }

  if (input.dueDate !== undefined) {
    const dd = parseDateOnly(input.dueDate)
    if (input.dueDate && !dd) {
      return financialError("INVALID_INPUT", "Data de vencimento inválida.", 400)
    }
    data.dueDate = dd
    changes.push("vencimento alterado")
  }

  if (input.notes !== undefined) {
    data.notes = input.notes?.trim() || null
  }

  if (Object.keys(data).length === 0) {
    return financialError("INVALID_INPUT", "Nada para atualizar.", 400)
  }

  return prisma.$transaction(async (tx) => {
    // Consistência: não permitir reduzir o valor abaixo do que já foi pago.
    if (newAmount !== null) {
      const payments = await tx.expensePayment.findMany({
        where: { expenseId: expense.id },
        select: { amount: true },
      })
      let paidCents = 0
      for (const p of payments) paidCents += toCents(p.amount)
      if (toCents(newAmount) < paidCents) {
        return financialError(
          "INVALID_INPUT",
          `O valor (${formatCurrency(newAmount)}) não pode ser menor que o já pago (${formatCurrency(
            fromCents(paidCents)
          )}).`,
          400
        )
      }
      // Recalcula o status armazenado para refletir o novo saldo.
      data.status =
        toCents(newAmount) - paidCents <= 0
          ? "paid"
          : paidCents > 0
            ? "partial"
            : "pending"
    }

    await tx.expense.update({ where: { id: expense.id }, data })

    // A movimentação acompanha a alteração (mantém a consolidação coerente).
    const txData: Record<string, unknown> = {}
    if (data.amount !== undefined) txData.amount = data.amount
    if (data.competenceDate !== undefined) txData.competenceDate = data.competenceDate
    if (data.description !== undefined) txData.description = data.description
    if (Object.keys(txData).length > 0) {
      await tx.financialTransaction.updateMany({
        where: { expenseId: expense.id },
        data: txData,
      })
    }

    await addLog(
      tx,
      expense.id,
      "updated",
      changes.length > 0 ? `Alterações: ${changes.join("; ")}` : "Despesa atualizada",
      actor
    )

    return { id: expense.id }
  })
}

/** Alias retrocompatível: a implementação A chamava isto de `updateExpense`. */
export const updateExpense = updateDespesa

// ===========================================================================
// PAGAMENTOS (múltiplos / parciais)
// ===========================================================================

export interface RegisterDespesaPaymentInput {
  expenseId: string
  amount: number
  paymentMethod: string
  paidAt?: string
  notes?: string | null
}

export interface RegisterDespesaPaymentResult {
  paymentId: string
  expenseId: string
  amount: number
  paymentMethod: string
  paymentMethodLabel: string
  paidAt: string
  balanceBefore: number
  balanceAfter: number
  status: DespesaStatus
  statusLabel: string
}

/**
 * Upsert da movimentação financeira derivada (dentro de transação).
 */
async function upsertFinancialTransaction(
  tx: Prisma.TransactionClient,
  expenseId: string,
  data: {
    amount: number
    status: string
    competenceDate: Date
    settledAt: Date | null
    description: string
    paymentMethod: string | null
    actor: FinancialActor
  }
) {
  const existing = await tx.financialTransaction.findFirst({
    where: { expenseId },
    select: { id: true },
  })

  if (existing) {
    await tx.financialTransaction.update({
      where: { id: existing.id },
      data: {
        amount: data.amount,
        status: data.status,
        settledAt: data.settledAt,
        paymentMethod: data.paymentMethod,
      },
    })
  } else {
    await tx.financialTransaction.create({
      data: {
        direction: "out",
        amount: data.amount,
        status: data.status,
        competenceDate: data.competenceDate,
        settledAt: data.settledAt,
        description: data.description,
        expense: { connect: { id: expenseId } },
        paymentMethod: data.paymentMethod,
        createdById: data.actor?.userId ?? null,
        createdByName: normalizeActorName(data.actor?.name),
      },
    })
  }
}

/**
 * Registra um pagamento (parcial ou total) contra a despesa.
 *
 * CONCORRÊNCIA: a checagem de saldo e a inserção do pagamento acontecem na
 * MESMA transação, recontando os pagamentos existentes. Dois pedidos
 * simultâneos nunca somam além do valor da despesa.
 */
export async function registerDespesaPayment(
  input: RegisterDespesaPaymentInput,
  actor: FinancialActor
): Promise<RegisterDespesaPaymentResult | FinancialError> {
  const expense = await prisma.expense.findUnique({
    where: { id: input.expenseId },
    select: {
      id: true,
      status: true,
      amount: true,
      description: true,
      competenceDate: true,
      dueDate: true,
    },
  })
  if (!expense) {
    return financialError("EXPENSE_NOT_FOUND", "Despesa não encontrada.", 404)
  }
  if (expense.status === "cancelled") {
    return financialError(
      "INVALID_STATE",
      "Despesa cancelada não pode receber pagamento.",
      409
    )
  }

  const paymentAmount = normalizeAmount(input.amount)
  if (toCents(paymentAmount) <= 0) {
    return financialError("INVALID_INPUT", "Valor do pagamento deve ser maior que zero.", 400)
  }

  const method = input.paymentMethod?.trim() || "outros"
  if (!DESPESA_PAYMENT_METHODS.includes(method as (typeof DESPESA_PAYMENT_METHODS)[number])) {
    return financialError(
      "INVALID_INPUT",
      `Forma de pagamento inválida. Use uma de: ${DESPESA_PAYMENT_METHODS.join(", ")}.`,
      400
    )
  }

  const actorName = normalizeActorName(actor?.name)
  const paidAt = input.paidAt ? parseDateOnly(input.paidAt) ?? new Date() : new Date()
  const totalCents = toCents(expense.amount)
  const paymentCents = toCents(paymentAmount)

  return prisma.$transaction(async (tx) => {
    // Reconta o pago DENTRO da transação (proteção contra concorrência).
    const existingPayments = await tx.expensePayment.findMany({
      where: { expenseId: expense.id },
      select: { amount: true },
    })
    let paidCents = 0
    for (const p of existingPayments) paidCents += toCents(p.amount)

    const balanceCents = totalCents - paidCents
    if (balanceCents <= 0) {
      return financialError("INVALID_STATE", "Despesa já está quitada.", 409)
    }
    if (paymentCents > balanceCents) {
      return financialError(
        "INVALID_INPUT",
        `Valor do pagamento (${formatCurrency(paymentAmount)}) excede o saldo de ${formatCurrency(
          fromCents(balanceCents)
        )}.`,
        400
      )
    }

    const payment = await tx.expensePayment.create({
      data: {
        expenseId: expense.id,
        amount: paymentAmount,
        paymentMethod: method,
        paidAt,
        notes: input.notes?.trim() || null,
        paidById: actor?.userId ?? null,
        paidByName: actorName,
      },
      select: { id: true },
    })

    const newPaidCents = paidCents + paymentCents
    const newBalanceCents = totalCents - newPaidCents
    const settled = newBalanceCents <= 0

    await tx.expense.update({
      where: { id: expense.id },
      data: {
        status: settled ? "paid" : "partial",
        paidAt: settled ? paidAt : null,
        paymentMethod: method,
        paidById: actor?.userId ?? null,
        paidByName: actorName,
      },
    })

    // A movimentação reflete o TOTAL já pago (projeção de caixa da despesa).
    await upsertFinancialTransaction(tx, expense.id, {
      amount: fromCents(newPaidCents),
      status: settled ? "settled" : "pending",
      competenceDate: expense.competenceDate,
      settledAt: settled ? paidAt : null,
      description: expense.description,
      paymentMethod: method,
      actor,
    })

    const logDesc = settled
      ? `Pagamento de ${formatCurrency(paymentAmount)} — despesa quitada`
      : `Pagamento parcial de ${formatCurrency(paymentAmount)} — saldo restante: ${formatCurrency(
          fromCents(newBalanceCents)
        )}`
    await addLog(tx, expense.id, settled ? "paid" : "payment", logDesc, actor)

    const balanceAfter = fromCents(newBalanceCents)
    const derived = deriveDespesaStatus({
      cancelled: false,
      balance: balanceAfter,
      paidAmount: fromCents(newPaidCents),
      dueDate: expense.dueDate,
    })

    return {
      paymentId: payment.id,
      expenseId: expense.id,
      amount: paymentAmount,
      paymentMethod: method,
      paymentMethodLabel: paymentMethodLabel(method),
      paidAt: paidAt.toISOString(),
      balanceBefore: fromCents(balanceCents),
      balanceAfter,
      status: derived,
      statusLabel: despesaStatusLabel(derived),
    }
  })
}

/**
 * Quita uma despesa integralmente (atalho). Idempotente: se já está quitada,
 * retorna INVALID_STATE sem duplicar movimentação.
 */
export async function payExpense(
  expenseId: string,
  options: { paymentMethod?: string | null } = {},
  actor: FinancialActor = { userId: null, name: "" }
): Promise<{ id: string } | FinancialError> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: { id: true, status: true, amount: true },
  })
  if (!expense) {
    return financialError("EXPENSE_NOT_FOUND", "Despesa não encontrada.", 404)
  }
  if (expense.status === "cancelled") {
    return financialError("INVALID_STATE", "Despesa cancelada não pode ser paga.", 409)
  }

  const payments = await prisma.expensePayment.findMany({
    where: { expenseId: expense.id },
    select: { amount: true },
  })
  let paidCents = 0
  for (const p of payments) paidCents += toCents(p.amount)
  const balanceCents = toCents(expense.amount) - paidCents
  if (balanceCents <= 0) {
    return financialError("INVALID_STATE", "Despesa já está quitada.", 409)
  }

  const result = await registerDespesaPayment(
    {
      expenseId: expense.id,
      amount: fromCents(balanceCents),
      paymentMethod: options.paymentMethod?.trim() || "outros",
    },
    actor
  )
  if (isFinancialError(result)) return result
  return { id: expense.id }
}

// ===========================================================================
// CANCELAMENTO
// ===========================================================================

export async function cancelDespesa(
  expenseId: string,
  reason: string | null,
  actor: FinancialActor = { userId: null, name: "" }
): Promise<{ id: string } | FinancialError> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: { id: true, status: true, description: true },
  })
  if (!expense) {
    return financialError("EXPENSE_NOT_FOUND", "Despesa não encontrada.", 404)
  }
  if (expense.status === "cancelled") {
    return financialError("INVALID_STATE", "Despesa já está cancelada.", 409)
  }

  const actorName = normalizeActorName(actor?.name)

  return prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: expense.id },
      data: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledById: actor?.userId ?? null,
        cancelledByName: actorName,
        cancelReason: reason?.trim() || null,
      },
    })

    // A movimentação acompanha o cancelamento — nunca fica "efetivada" sozinha.
    await tx.financialTransaction.updateMany({
      where: { expenseId: expense.id },
      data: { status: "cancelled" },
    })

    await addLog(
      tx,
      expense.id,
      "cancelled",
      `Despesa cancelada.${reason ? ` Motivo: ${reason.trim()}` : ""}`,
      actor
    )

    return { id: expense.id }
  })
}

/** Alias retrocompatível: a implementação A chamava isto de `cancelExpense`. */
export const cancelExpense = cancelDespesa

// ===========================================================================
// LISTAGEM (paginada, filtrada, com summary)
// ===========================================================================

/** Ordenação padrão: vencidas primeiro, depois mais recentes. */
const DEFAULT_SORT: Prisma.ExpenseOrderByWithRelationInput[] = [
  { dueDate: "asc" },
  { competenceDate: "desc" },
  { createdAt: "desc" },
]

/** Traduz o status derivado (canônico) para o status ARMAZENADO no banco. */
function storedStatusFilter(status: string): Prisma.ExpenseWhereInput | null {
  switch (status) {
    case "PENDENTE":
      return { status: "pending" }
    case "PARCIAL":
      return { status: "partial" }
    case "PAGA":
      return { status: "paid" }
    case "CANCELADA":
      return { status: "cancelled" }
    case "VENCIDA":
      // VENCIDA é DERIVADA: saldo > 0 e vencimento no passado. Não é armazenada.
      return {
        status: { notIn: ["paid", "cancelled"] },
        dueDate: { lt: new Date(new Date().setHours(0, 0, 0, 0)) },
      }
    default:
      return null
  }
}

export async function listDespesas(
  options: ListDespesasOptions = {}
): Promise<ListDespesasResult> {
  const page = Math.max(1, options.page ?? 1)
  const pageSize = Math.min(Math.max(1, options.pageSize ?? 20), 100)

  const preset = options.period ?? "month"
  const reference = new Date()
  const { start, end } = resolvePeriodRange(preset, reference, {
    from: options.from,
    to: options.to,
  })

  const where: Prisma.ExpenseWhereInput = {}

  if (preset !== "all") {
    where.competenceDate = { gte: start, lte: end }
  }

  if (options.status) {
    const statusFilter = storedStatusFilter(options.status)
    if (statusFilter) Object.assign(where, statusFilter)
  }

  if (options.categoryId) {
    where.categoryId = options.categoryId
  }

  if (options.paymentMethod) {
    where.paymentMethod = options.paymentMethod
  }

  if (options.supplier) {
    where.supplier = { contains: options.supplier }
  }

  if (options.search && options.search.trim()) {
    const s = options.search.trim()
    where.OR = [
      { description: { contains: s } },
      { supplier: { contains: s } },
      { notes: { contains: s } },
      { id: { contains: s } },
    ]
  }

  const totalCount = await prisma.expense.count({ where })
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  let orderBy: Prisma.ExpenseOrderByWithRelationInput[]
  if (options.sort && options.sort !== "dueDate") {
    orderBy = [{ [options.sort]: options.direction === "asc" ? "asc" : "desc" }]
  } else {
    orderBy = DEFAULT_SORT
  }

  const rows = await prisma.expense.findMany({
    where,
    orderBy,
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      description: true,
      supplier: true,
      amount: true,
      status: true,
      competenceDate: true,
      dueDate: true,
      paidAt: true,
      paymentMethod: true,
      notes: true,
      createdByName: true,
      paidByName: true,
      cancelledAt: true,
      cancelledByName: true,
      cancelReason: true,
      category: { select: { id: true, name: true, kind: true } },
      payments: {
        select: { amount: true, paidAt: true },
        orderBy: { paidAt: "desc" },
      },
    },
  })

  const despesas: DespesaItem[] = rows.map((e) => {
    let paidCents = 0
    let lastPaymentDate: string | null = null
    for (const p of e.payments) {
      paidCents += toCents(p.amount)
      if (!lastPaymentDate || p.paidAt > new Date(lastPaymentDate)) {
        lastPaymentDate = p.paidAt.toISOString()
      }
    }
    const totalCents = toCents(e.amount)
    const balanceCents = totalCents - paidCents
    const amount = roundMoney(e.amount)
    const paidAmount = fromCents(paidCents)
    const balance = fromCents(Math.max(0, balanceCents))

    const derived = deriveDespesaStatus({
      cancelled: e.status === "cancelled",
      balance: e.status === "cancelled" ? 0 : balance,
      paidAmount: e.status === "cancelled" ? 0 : paidAmount,
      dueDate: e.dueDate,
      referenceDate: reference,
    })

    return {
      id: e.id,
      description: e.description,
      supplier: e.supplier,
      categoryId: e.category.id,
      categoryName: e.category.name,
      categoryKind: e.category.kind,
      amount,
      paidAmount,
      balance,
      status: derived,
      statusLabel: despesaStatusLabel(derived),
      competenceDate: formatDateISO(e.competenceDate),
      dueDate: e.dueDate ? formatDateISO(e.dueDate) : null,
      paidAt: e.paidAt?.toISOString() ?? null,
      lastPaymentDate,
      paymentMethod: e.paymentMethod,
      paymentMethodLabel: paymentMethodLabel(e.paymentMethod),
      notes: e.notes,
      documentNumber: null,
      isRecurring: false,
      createdByName: e.createdByName,
      paidByName: e.paidByName,
      cancelledAt: e.cancelledAt?.toISOString() ?? null,
      cancelledByName: e.cancelledByName,
      cancelReason: e.cancelReason,
    }
  })

  const summary = await computeDespesasSummary(where, reference)

  const safePage = Math.min(page, totalPages)
  const from = totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1

  return {
    despesas,
    summary,
    pagination: {
      page: safePage,
      pageSize,
      totalPages,
      totalCount,
      hasPrevious: safePage > 1,
      hasNext: safePage < totalPages,
      from,
      to: Math.min(from + pageSize - 1, totalCount),
    },
    period: {
      preset,
      from: formatDateISO(start),
      to: formatDateISO(end),
    },
  }
}

/**
 * Listagem simples (compatibilidade com o formato antigo da implementação A).
 * NÃO contém regra de negócio própria — apenas projeta `listDespesas`.
 */
export async function listExpenses(options: {
  preset?: string
  from?: string
  to?: string
  status?: string
  categoryId?: string
  limit?: number
} = {}) {
  const result = await listDespesas({
    period: options.preset,
    from: options.from,
    to: options.to,
    status: options.status,
    categoryId: options.categoryId,
    page: 1,
    pageSize: Math.min(options.limit ?? 50, 100),
  })

  return result.despesas.map((d) => ({
    id: d.id,
    description: d.description,
    supplier: d.supplier,
    amount: d.amount,
    status: d.status,
    competenceDate: d.competenceDate,
    dueDate: d.dueDate,
    paidAt: d.paidAt,
    paymentMethod: d.paymentMethod,
    notes: d.notes,
    createdByName: d.createdByName,
    paidByName: d.paidByName,
    cancelledAt: d.cancelledAt,
    cancelledByName: d.cancelledByName,
    cancelReason: d.cancelReason,
    category: { id: d.categoryId, name: d.categoryName, kind: d.categoryKind },
    patientName: null as string | null,
  }))
}

// ===========================================================================
// SUMMARY (cards de resumo) — calculado SEMPRE no backend
// ===========================================================================

async function computeDespesasSummary(
  where: Prisma.ExpenseWhereInput,
  reference: Date
): Promise<DespesasSummary> {
  const allExpenses = await prisma.expense.findMany({
    where,
    select: {
      id: true,
      amount: true,
      status: true,
      dueDate: true,
      payments: { select: { amount: true } },
    },
  })

  let totalCents = 0
  let paidCents = 0
  let overdueCents = 0
  let dueTodayCents = 0
  let upcomingCents = 0

  let totalCount = 0
  let paidCount = 0
  let pendingCount = 0
  let overdueCount = 0
  let dueTodayCount = 0
  let cancelledCount = 0

  const todayKey = toDayKey(reference)

  for (const e of allExpenses) {
    totalCount++
    if (e.status === "cancelled") {
      cancelledCount++
      continue
    }

    const expCents = toCents(e.amount)
    totalCents += expCents

    let expPaidCents = 0
    for (const p of e.payments) expPaidCents += toCents(p.amount)
    paidCents += expPaidCents

    const balanceCents = expCents - expPaidCents

    if (balanceCents <= 0) {
      paidCount++
    } else {
      pendingCount++
      if (e.dueDate) {
        const dueKey = toDayKey(e.dueDate)
        if (dueKey < todayKey) {
          overdueCents += balanceCents
          overdueCount++
        } else if (dueKey === todayKey) {
          dueTodayCents += balanceCents
          dueTodayCount++
        } else {
          upcomingCents += balanceCents
        }
      } else {
        upcomingCents += balanceCents
      }
    }
  }

  return {
    totalExpenses: fromCents(totalCents),
    totalPaid: fromCents(paidCents),
    totalPending: fromCents(totalCents - paidCents),
    totalOverdue: fromCents(overdueCents),
    dueToday: fromCents(dueTodayCents),
    upcoming: fromCents(upcomingCents),
    totalCount,
    paidCount,
    pendingCount,
    overdueCount,
    dueTodayCount,
    cancelledCount,
  }
}

// ===========================================================================
// DETALHE
// ===========================================================================

export async function getDespesaDetail(expenseId: string): Promise<DespesaDetail | null> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      description: true,
      supplier: true,
      amount: true,
      status: true,
      competenceDate: true,
      dueDate: true,
      paidAt: true,
      paymentMethod: true,
      notes: true,
      createdById: true,
      createdByName: true,
      createdAt: true,
      updatedAt: true,
      cancelledAt: true,
      cancelledByName: true,
      cancelReason: true,
      category: { select: { id: true, name: true, kind: true } },
      payments: {
        orderBy: { paidAt: "desc" },
        select: {
          id: true,
          amount: true,
          paymentMethod: true,
          paidAt: true,
          notes: true,
          paidByName: true,
          createdAt: true,
        },
      },
      logs: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          event: true,
          description: true,
          oldValue: true,
          newValue: true,
          performedByName: true,
          createdAt: true,
        },
      },
    },
  })

  if (!expense) return null

  let paidCents = 0
  const payments: DespesaPaymentEntry[] = expense.payments.map((p) => {
    paidCents += toCents(p.amount)
    return {
      id: p.id,
      amount: roundMoney(p.amount),
      paymentMethod: p.paymentMethod,
      paymentMethodLabel: paymentMethodLabel(p.paymentMethod),
      paidAt: p.paidAt.toISOString(),
      notes: p.notes,
      paidByName: p.paidByName,
      createdAt: p.createdAt.toISOString(),
    }
  })

  const totalCents = toCents(expense.amount)
  const balanceCents = Math.max(0, totalCents - paidCents)
  const amount = roundMoney(expense.amount)
  const paidAmount = fromCents(paidCents)
  const balance = fromCents(balanceCents)
  const paidPercent = totalCents > 0 ? Math.round((paidCents / totalCents) * 100) : 0

  const logs: DespesaLogEntry[] = expense.logs.map((l) => ({
    id: l.id,
    event: l.event,
    description: l.description,
    oldValue: l.oldValue,
    newValue: l.newValue,
    performedByName: l.performedByName,
    createdAt: l.createdAt.toISOString(),
  }))

  const derived = deriveDespesaStatus({
    cancelled: expense.status === "cancelled",
    balance,
    paidAmount,
    dueDate: expense.dueDate,
  })

  return {
    id: expense.id,
    description: expense.description,
    supplier: expense.supplier,
    categoryId: expense.category.id,
    categoryName: expense.category.name,
    categoryKind: expense.category.kind,
    amount,
    paidAmount,
    balance,
    paidPercent,
    status: derived,
    statusLabel: despesaStatusLabel(derived),
    competenceDate: formatDateISO(expense.competenceDate),
    dueDate: expense.dueDate ? formatDateISO(expense.dueDate) : null,
    paymentMethod: expense.paymentMethod,
    paymentMethodLabel: paymentMethodLabel(expense.paymentMethod),
    notes: expense.notes,
    documentNumber: null,
    isRecurring: false,
    createdByName: expense.createdByName,
    createdById: expense.createdById,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
    cancelledAt: expense.cancelledAt ? expense.cancelledAt.toISOString() : null,
    cancelledByName: expense.cancelledByName,
    cancelReason: expense.cancelReason,
    payments,
    logs,
  }
}

// ===========================================================================
// CONVÊNIOS (InsurancePlan)
// ===========================================================================
// Convênios NÃO são despesas: são a contraparte de cobertura de paciente/
// atendimento. Permanecem neste módulo apenas como dado de referência do
// Financeiro (não participam de nenhum cálculo de Despesa).

export async function listInsurancePlans(options: { includeInactive?: boolean } = {}) {
  return prisma.insurancePlan.findMany({
    where: options.includeInactive ? {} : { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      coveragePercent: true,
      ansCode: true,
      active: true,
    },
  })
}

export async function createInsurancePlan(input: {
  name: string
  kind: string
  coveragePercent?: number | null
  ansCode?: string | null
}): Promise<{ id: string } | FinancialError> {
  const name = (input.name ?? "").trim()
  if (name.length < 2) {
    return financialError("INVALID_INPUT", "Nome do convênio é obrigatório.", 400)
  }
  if (!input.kind || !isInsurancePlanKind(input.kind)) {
    return financialError(
      "INVALID_INPUT",
      `Tipo inválido. Use um de: ${INSURANCE_PLAN_KINDS.join(", ")}.`,
      400
    )
  }

  const existing = await prisma.insurancePlan.findUnique({
    where: { name },
    select: { id: true },
  })
  if (existing) {
    return financialError("INVALID_INPUT", "Já existe um convênio com esse nome.", 409)
  }

  let coveragePercent: number | null = null
  if (input.coveragePercent != null) {
    const n = Number(input.coveragePercent)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return financialError(
        "INVALID_INPUT",
        "Percentual de cobertura deve estar entre 0 e 100.",
        400
      )
    }
    coveragePercent = roundMoney(n)
  }

  return prisma.insurancePlan.create({
    data: {
      name,
      kind: input.kind,
      coveragePercent,
      ansCode: input.ansCode?.trim() || null,
    },
    select: { id: true },
  })
}

// ===========================================================================
// COMPATIBILIDADE — nomes pré-consolidação (implementação A)
// ===========================================================================
// A implementação A expunha estes nomes. Eles continuam válidos como ALIASES
// finos das funções canônicas — nenhuma lógica é duplicada aqui. Código novo
// deve preferir os nomes canônicos. `updateExpense` e `cancelExpense` são
// declarados logo abaixo de suas funções canônicas; o alias de criação fica
// aqui, junto do seu tipo (`CreateExpenseInput`).

/** @deprecated Use `createDespesa`. */
export const createExpense = createDespesa


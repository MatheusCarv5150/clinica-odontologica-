// ===========================================================================
// SERVIÇO FINANCEIRO — módulo Financeiro (Parte 11 — Financeiro 1).
// ===========================================================================
//
// RESPONSABILIDADES
// - Consolidar os pagamentos e despesas EXISTENTES numa visão de fluxo.
// - Produzir os números do Dashboard a partir de dados REAIS.
// - Manter sincronizadas as movimentações derivadas dos pagamentos.
// - Resolver SEMPRE o contexto (paciente/atendimento) no servidor.
//
// NÃO FAZ
// - não cria uma segunda tabela de pagamentos;
// - não duplica catálogo de procedimentos, pacientes nem planos;
// - não inventa valores para preencher gráfico (zero é zero);
// - não simula autenticação/RBAC (decisão 3-A);
// - não introduz multi-tenancy (decisão 2-A).
//
// SEGURANÇA DESTA FASE (single-tenant + isolamento por relacionamento)
//
// O cliente NUNCA define o paciente de uma movimentação. Sempre que um
// `appointmentId` é fornecido, o serviço:
//   1) busca o atendimento;
//   2) deriva o `patientId` do próprio atendimento;
//   3) valida a existência;
//   4) opera apenas dentro daquele contexto.
// Um `patientId` divergente enviado pelo cliente é REJEITADO, não obedecido.

import { prisma } from "@/lib/prisma"
import {
  deriveIncomeFromPayment,
  roundMoney,
  toCents,
  paymentMethodLabel,
} from "@/lib/financial-domain"

// ---------------------------------------------------------------------------
// Erros de domínio (traduzidos para HTTP na camada de rota)
// ---------------------------------------------------------------------------

export type FinancialErrorCode =
  | "INVALID_INPUT"
  | "APPOINTMENT_NOT_FOUND"
  | "PATIENT_NOT_FOUND"
  | "CONTEXT_MISMATCH"
  | "EXPENSE_NOT_FOUND"
  | "CATEGORY_NOT_FOUND"
  | "INVALID_STATE"

export interface FinancialError {
  error: string
  code: FinancialErrorCode
  status: number
}

export function financialError(
  code: FinancialErrorCode,
  message: string,
  status: number
): FinancialError {
  return { error: message, code, status }
}

/** Discrimina o resultado de uma operação de domínio. */
export function isFinancialError(value: unknown): value is FinancialError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "status" in value &&
    "error" in value
  )
}

// ---------------------------------------------------------------------------
// Ator (identidade textual — NÃO é autenticação)
// ---------------------------------------------------------------------------
// Mesmo contrato usado no restante do sistema. `userId` fica preparado para uma
// futura autenticação real; enquanto ela não existir, permanece null e o nome
// é apenas ATRIBUIÇÃO de quem executou a ação.

export interface FinancialActor {
  userId: string | null
  name: string
}

const UNKNOWN_ACTOR = "Não informado"

export function normalizeActorName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim()
  return trimmed.length > 0 ? trimmed : UNKNOWN_ACTOR
}

// ===========================================================================
// SINCRONIZAÇÃO DAS MOVIMENTAÇÕES DE RECEITA
// ===========================================================================
// O pagamento é a FONTE. A movimentação é a projeção consolidada.
// Esta rotina garante que exista exatamente UMA movimentação por pagamento,
// sem nunca copiar o pagamento para uma tabela paralela.

export interface SyncIncomeResult {
  created: number
  updated: number
  scanned: number
}

const PAYMENT_SELECT = {
  id: true,
  amount: true,
  status: true,
  paidAt: true,
  createdAt: true,
  paymentMethod: true,
  appointmentId: true,
  appointment: { select: { patientId: true } },
} as const

/**
 * Sincroniza as movimentações de receita a partir dos pagamentos existentes.
 *
 * Idempotente: rodar duas vezes não duplica nada (`paymentId` é único).
 *
 * `actorName` é ATRIBUIÇÃO textual (não autenticação).
 */
export async function syncIncomeFromPayments(
  options: { actorName?: string } = {}
): Promise<SyncIncomeResult> {
  const actorName = normalizeActorName(options.actorName)

  const payments = await prisma.payment.findMany({ select: PAYMENT_SELECT })

  let created = 0
  let updated = 0

  for (const payment of payments) {
    const derived = deriveIncomeFromPayment(payment)

    // O paciente é derivado do ATENDIMENTO (nunca de entrada do cliente).
    const patientId = payment.appointment?.patientId ?? null

    const existing = await prisma.financialTransaction.findUnique({
      where: { paymentId: payment.id },
      select: { id: true, status: true, amount: true, patientId: true },
    })

    const data = {
      direction: "in" as const,
      amount: roundMoney(payment.amount),
      status: derived.status,
      competenceDate: derived.competenceDate,
      settledAt: derived.status === "settled" ? derived.competenceDate : null,
      description: `Recebimento — ${paymentMethodLabel(payment.paymentMethod)}`,
      expenseId: null,
      patientId,
      appointmentId: payment.appointmentId,
      paymentMethod: payment.paymentMethod,
      createdByName: actorName,
    }

    if (!existing) {
      await prisma.financialTransaction.create({
        data: { ...data, paymentId: payment.id },
      })
      created++
      continue
    }

    const changed =
      existing.status !== data.status ||
      toCents(existing.amount) !== toCents(data.amount) ||
      existing.patientId !== data.patientId

    if (changed) {
      await prisma.financialTransaction.update({ where: { id: existing.id }, data })
      updated++
    }
  }

  return { created, updated, scanned: payments.length }
}

/**
 * Cria/atualiza a movimentação de receita de UM pagamento.
 * Usada pelo fluxo de registro de pagamento (Agenda) para manter o Financeiro
 * atualizado sem reescrever a rota existente.
 *
 * Não lança erro se o pagamento não existir: retorna null (o chamador decide).
 */
export async function syncIncomeFromPayment(
  paymentId: string,
  actorName?: string
): Promise<{ id: string } | null> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: PAYMENT_SELECT,
  })
  if (!payment) return null

  const derived = deriveIncomeFromPayment(payment)
  const patientId = payment.appointment?.patientId ?? null

  const existing = await prisma.financialTransaction.findUnique({
    where: { paymentId: payment.id },
    select: { id: true },
  })

  const data = {
    direction: "in" as const,
    amount: roundMoney(payment.amount),
    status: derived.status,
    competenceDate: derived.competenceDate,
    settledAt: derived.status === "settled" ? derived.competenceDate : null,
    description: `Recebimento — ${paymentMethodLabel(payment.paymentMethod)}`,
    expenseId: null,
    patientId,
    appointmentId: payment.appointmentId,
    paymentMethod: payment.paymentMethod,
    createdByName: normalizeActorName(actorName),
  }

  if (existing) {
    await prisma.financialTransaction.update({ where: { id: existing.id }, data })
    return { id: existing.id }
  }

  return prisma.financialTransaction.create({
    data: { ...data, paymentId: payment.id },
    select: { id: true },
  })
}

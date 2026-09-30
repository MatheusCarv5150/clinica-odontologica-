// ===========================================================================
// SERVIÇO DE PAGAMENTOS — módulo Financeiro (fonte de verdade do recebimento).
// ===========================================================================
//
// RESPONSABILIDADE ÚNICA
// - Registrar um pagamento (total ou parcial) contra um ATENDIMENTO existente.
// - Manter a projeção de caixa (`FinancialTransaction`) sincronizada.
//
// POR QUE ESTE ARQUIVO EXISTE (não duplicação)
//
// O pagamento é a FONTE. Este serviço é a única porta de entrada para criar um
// `Payment` a partir da interface. Ele é consumido por:
//   * Financeiro 2 — Receitas      (`financial-receitas-service.ts`)
//   * Financeiro 3 — Contas a receber (`financial-contas-receber-service.ts`)
//
// Ele foi extraído para um módulo próprio para evitar dependência circular
// entre esses dois serviços e para deixar explícito que existe UMA única forma
// de criar pagamento — nunca uma segunda tabela de pagamentos.
//
// SEGURANÇA DESTA FASE (single-tenant + isolamento por relacionamento)
// - O paciente NUNCA é aceito do cliente.
// - O `appointmentId` é a única chave aceita; o contexto (paciente,
//   procedimentos, valor previsto) é resolvido no SERVIDOR a partir dele.
// - Um `patientId` enviado pelo cliente é ignorado por construção: o serviço
//   não possui esse parâmetro.

import { prisma } from "@/lib/prisma"
import { roundMoney, toCents, fromCents } from "@/lib/financial-domain"
import { syncIncomeFromPayment, normalizeActorName } from "./financial-service"

// ---------------------------------------------------------------------------
// Formas de pagamento aceitas
// ---------------------------------------------------------------------------
// Mesmo vocabulário de `payments.payment_method` e de
// `FINANCIAL_PAYMENT_METHOD_LABELS` em `financial-domain.ts`.
// NÃO criar um segundo enum: o domínio é a fonte.

export const PAYMENT_METHODS = [
  "pix",
  "dinheiro",
  "cartao_debito",
  "cartao_credito",
  "transferencia",
  "boleto",
  "outros",
] as const

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

export class PaymentError extends Error {
  readonly code:
    | "APPOINTMENT_NOT_FOUND"
    | "INVALID_AMOUNT"
    | "INVALID_METHOD"
    | "EXCEEDS_PENDING"
  readonly status: number

  constructor(
    code: PaymentError["code"],
    message: string,
    status = 400
  ) {
    super(message)
    this.name = "PaymentError"
    this.code = code
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Cálculo do pendente de um atendimento
// ---------------------------------------------------------------------------
// REGRA: previsto = `appointments.total_amount` quando informado, senão a soma
// de `appointment_procedures.total_price` (mesma precedência usada em
// `computeAppointmentValues`, no domínio).
//
// "Já recebido" considera os pagamentos NÃO estornados. Um pagamento estornado
// (`refunded`) NÃO conta como recebido — ele não pode liberar saldo para um
// novo pagamento indevido, nem inflar o total recebido.

export interface AppointmentPendingContext {
  appointmentId: string
  patientId: string
  expected: number
  received: number
  pending: number
  overpaid: number
}

export async function getAppointmentPendingContext(
  appointmentId: string
): Promise<AppointmentPendingContext | null> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      patientId: true,
      totalAmount: true,
      procedures: { select: { totalPrice: true } },
      payments: { select: { amount: true, status: true } },
    },
  })

  if (!appointment) return null

  let proceduresCents = 0
  for (const p of appointment.procedures) proceduresCents += toCents(p.totalPrice)

  const expectedCents =
    appointment.totalAmount == null
      ? proceduresCents
      : toCents(appointment.totalAmount)

  let receivedCents = 0
  for (const p of appointment.payments) {
    if (p.status === "refunded") continue
    receivedCents += toCents(p.amount)
  }

  return {
    appointmentId: appointment.id,
    patientId: appointment.patientId,
    expected: fromCents(expectedCents),
    received: fromCents(receivedCents),
    pending: fromCents(Math.max(expectedCents - receivedCents, 0)),
    overpaid: fromCents(Math.max(receivedCents - expectedCents, 0)),
  }
}

// ---------------------------------------------------------------------------
// Registro de pagamento
// ---------------------------------------------------------------------------
// NÃO sobrescreve pagamento anterior: cada evento gera um NOVO registro em
// `payments` (pagamentos múltiplos são preservados individualmente).
//
// O status do atendimento é atualizado de forma consistente com o saldo:
//   pendente > 0  -> "awaiting_payment"  (parcial ou nada recebido)
//   pendente == 0 -> "paid"              (quitado)
// Atendimento `cancelled` NÃO é reaberto por um pagamento.

export interface RegisterPaymentInput {
  appointmentId: string
  amount: number
  paymentMethod: string
  actorName?: string
  /** Data efetiva do recebimento. Ausente = agora (comportamento padrão). */
  paidAt?: Date
}

export interface RegisterPaymentResult {
  payment: {
    id: string
    appointmentId: string
    amount: number
    paymentMethod: string
    status: string
    paidAt: Date | null
    createdAt: Date
  }
  pendingBefore: number
  pendingAfter: number
  appointmentStatus: string
}

export async function registerPaymentForAppointment(
  input: RegisterPaymentInput
): Promise<RegisterPaymentResult> {
  const amount = roundMoney(input.amount)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentError(
      "INVALID_AMOUNT",
      "O valor do pagamento deve ser maior que zero."
    )
  }
  if (!isPaymentMethod(input.paymentMethod)) {
    throw new PaymentError(
      "INVALID_METHOD",
      `Forma de pagamento inválida: ${String(input.paymentMethod)}.`
    )
  }

  const context = await getAppointmentPendingContext(input.appointmentId)
  if (!context) {
    throw new PaymentError("APPOINTMENT_NOT_FOUND", "Atendimento não encontrado.", 404)
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: { status: true },
  })

  const actorName = normalizeActorName(input.actorName)
  const paidAt = input.paidAt ?? new Date()

  const payment = await prisma.payment.create({
    data: {
      appointmentId: input.appointmentId,
      amount,
      paymentMethod: input.paymentMethod,
      status: "paid",
      paidAt,
    },
    select: {
      id: true,
      appointmentId: true,
      amount: true,
      paymentMethod: true,
      status: true,
      paidAt: true,
      createdAt: true,
    },
  })

  const pendingAfter = fromCents(
    Math.max(toCents(context.pending) - toCents(amount), 0)
  )

  // Atendimento cancelado NÃO volta a "paid"/"awaiting_payment".
  let appointmentStatus = appointment?.status ?? "scheduled"
  if (appointmentStatus !== "cancelled") {
    appointmentStatus = pendingAfter > 0 ? "awaiting_payment" : "paid"
    await prisma.appointment.update({
      where: { id: input.appointmentId },
      data: { status: appointmentStatus },
    })
  }

  // Projeção de caixa (RECEITA). Idempotente por `paymentId`.
  // O Financeiro NÃO guarda um segundo pagamento — apenas a movimentação.
  await syncIncomeFromPayment(payment.id, actorName)

  return {
    payment,
    pendingBefore: context.pending,
    pendingAfter,
    appointmentStatus,
  }
}

// ===========================================================================
// SERVIÇO DE RECEITAS — módulo Financeiro (Financeiro 2 — Receitas).
// ===========================================================================
//
// O QUE ESTE SERVIÇO É
//
// A leitura financeira dos valores EFETIVAMENTE RECEBIDOS pela clínica, com
// filtros, busca, ordenação e paginação — tudo resolvido no SERVIDOR.
//
// QUAL É A FONTE DA VERDADE (e por que não há duplicação)
//
//   Payment (fonte)  --deriva-->  FinancialTransaction (projeção)
//
// O `Payment` é o EVENTO concreto de recebimento, ligado a um atendimento.
// A `FinancialTransaction` é a PROJEÇÃO consolidada usada por Dashboard, Fluxo
// de Caixa e Relatórios. Um pagamento tem no máximo UMA movimentação
// (`paymentId` é `@unique`).
//
// PORTANTO: este serviço NUNCA cria receita. Ele LÊ. A única escrita que ele
// dispara é o registro de um NOVO pagamento — que sempre passa pelo serviço
// canônico `registerPaymentForAppointment` (`financial-payments-service.ts`),
// jamais por uma tabela paralela.
//
// O QUE É UMA "RECEITA" AQUI
//
// A receita do Financeiro 2 é a LINHA DE RECEBIMENTO vinculada a um
// atendimento. Um atendimento com cobrança de R$ 1.000 do qual o paciente
// pagou R$ 400 produz UMA linha de R$ 400 com status PARCIAL — nunca R$ 1.000
// como recebido. O saldo restante é assunto do Financeiro 3 (Contas a Receber).
//
// ISOLAMENTO (single-tenant)
//
// Não existe autenticação/RBAC nesta fase (decisão 3-A). O `professionalName`
// e `createdByName` são ATRIBUIÇÃO textual ("quem fez"), não identidade de
// acesso. O paciente NUNCA é aceito do cliente: é sempre derivado do
// atendimento/pagamento no servidor.

import { prisma } from "@/lib/prisma"
import {
  fromCents,
  paymentMethodLabel,
  resolvePeriodRange,
  roundMoney,
  toCents,
} from "@/lib/financial-domain"
import {
  registerPaymentForAppointment,
} from "@/lib/financial-payments-service"
import { normalizeActorName } from "@/lib/financial-service"

// ---------------------------------------------------------------------------
// Tipos de saída (contrato consumido pela API e pela tela)
// ---------------------------------------------------------------------------

/** Status apresentável da receita (distinto do status da movimentação). */
export const RECEITA_STATUSES = [
  "settled", // recebido integralmente
  "partial", // recebido parcialmente — há saldo
  "pending", // previsto, nada recebido
  "cancelled", // cancelado — fora de todos os totais
  "reversed", // estornado — fora de todos os totais
] as const

export type ReceitaStatus = (typeof RECEITA_STATUSES)[number]

export const RECEITA_STATUS_LABELS: Record<string, string> = {
  settled: "Recebido",
  partial: "Parcial",
  pending: "Previsto",
  cancelled: "Cancelado",
  reversed: "Estornado",
}

export const RECEITA_ORIGIN_LABELS: Record<string, string> = {
  appointment: "Atendimento",
  schedule: "Agendamento",
  manual: "Manual",
}

export interface ReceitaProcedure {
  procedureId: string | null
  /** Nome no momento da venda (snapshot histórico — não segue o catálogo). */
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface ReceitaItem {
  /** Identificador estável da LINHA (a movimentação; fallback: o pagamento). */
  id: string
  paymentId: string | null
  appointmentId: string | null
  /** Código curto do atendimento, quando existir (ex.: "A1B2C3D4"). */
  appointmentCode: string | null
  patientId: string | null
  patientName: string
  patientCpf: string | null
  patientPhone: string | null

  origin: string
  originLabel: string

  /** Data/hora efetiva do recebimento (competência). */
  receivedAt: string | null
  /** Data/hora de criação do REGISTRO (distinta da data do recebimento). */
  createdAt: string

  /** Valor EFETIVAMENTE recebido nesta linha. Nunca é o valor previsto. */
  amount: number
  /** Total cobrado/previsto do atendimento (contexto de saldo). */
  expectedTotal: number
  /** Total já recebido no atendimento (inclui esta linha). */
  receivedTotal: number
  /** Saldo remanescente do atendimento (0 quando quitado). */
  pendingTotal: number

  paymentMethod: string | null
  paymentMethodLabel: string
  status: ReceitaStatus
  statusLabel: string

  professionalName: string | null
  /** ATRIBUIÇÃO textual — não é autenticação. */
  createdByName: string | null

  description: string
  notes: string | null
  procedures: ReceitaProcedure[]

  reversedAt: string | null
  reverseReason: string | null
  reversedByName: string | null
}

export interface ReceitasSummary {
  /** 1. Total efetivamente recebido no período (parcial conta pelo valor pago). */
  totalReceived: number
  /** 2. Quantidade de recebimentos efetivados. */
  receivedCount: number
  /** 3. Ticket médio = totalRecebido / quantidade. */
  averageTicket: number
  /** 4. Total recebido hoje (independente do período selecionado). */
  receivedToday: number
  /** Saldo em aberto do período (contexto — não é receita). */
  totalPending: number
  /** Quantidade de receitas previstas (nada recebido). */
  pendingCount: number
  /** Quantidade de receitas parciais. */
  partialCount: number
  /** Quantidade de linhas após filtros (para paginação). */
  totalCount: number
}

export interface ListReceitasOptions {
  period?: string
  from?: string
  to?: string
  status?: string
  paymentMethod?: string
  origin?: string
  professionalName?: string
  search?: string
  sort?: "date" | "amount" | "patient"
  direction?: "asc" | "desc"
  page?: number
  pageSize?: number
}

export interface ListReceitasResult {
  receitas: ReceitaItem[]
  summary: ReceitasSummary
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
// Derivados
// ---------------------------------------------------------------------------

/** Código curto e estável para exibição de um atendimento. */
export function appointmentCode(appointmentId: string | null | undefined): string | null {
  if (!appointmentId) return null
  return appointmentId.slice(-8).toUpperCase()
}

/**
 * Status apresentável de uma receita, a partir do estado da movimentação e do
 * saldo do atendimento.
 *
 *   cancelled/reversed -> mantidos (fora dos totais)
 *   settled + saldo > 0 -> "partial" (recebimento parcial)
 *   settled + saldo <= 0 -> "settled"
 *   pending -> "pending"
 */
export function deriveReceitaStatus(
  transactionStatus: string,
  pendingTotal: number
): ReceitaStatus {
  if (transactionStatus === "cancelled") return "cancelled"
  if (transactionStatus === "reversed") return "reversed"
  if (transactionStatus === "pending") return "pending"
  return pendingTotal > 0 ? "partial" : "settled"
}

/** Origem da receita — derivada, nunca informada pelo cliente. */
export function deriveReceitaOrigin(appointmentStatus: string | null): string {
  if (!appointmentStatus) return "manual"
  if (appointmentStatus === "scheduled") return "schedule"
  return "appointment"
}

export function receitaStatusLabel(status: string): string {
  return RECEITA_STATUS_LABELS[status] ?? status
}

export function receitaOriginLabel(origin: string): string {
  return RECEITA_ORIGIN_LABELS[origin] ?? origin
}

// ---------------------------------------------------------------------------
// Contexto do atendimento (previsto / recebido / pendente)
// ---------------------------------------------------------------------------
// Calculado no servidor para TODOS os atendimentos envolvidos de uma vez
// (uma consulta por lote), evitando N+1 e mantendo o pendente consistente com
// `computeAppointmentValues` do domínio.

interface AppointmentContext {
  expectedTotal: number
  receivedTotal: number
  pendingTotal: number
  patientId: string
  patientName: string
  patientCpf: string | null
  patientPhone: string | null
  appointmentStatus: string
  professionalName: string | null
  procedures: ReceitaProcedure[]
}

async function loadAppointmentContexts(
  appointmentIds: string[]
): Promise<Map<string, AppointmentContext>> {
  const unique = [...new Set(appointmentIds.filter(Boolean))]
  const map = new Map<string, AppointmentContext>()
  if (unique.length === 0) return map

  const appointments = await prisma.appointment.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      patientId: true,
      status: true,
      totalAmount: true,
      finishedByName: true,
      patient: { select: { fullName: true, cpf: true, phone: true } },
      procedures: {
        select: {
          procedureId: true,
          procedureNameSnapshot: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
        },
      },
      payments: { select: { amount: true, status: true } },
    },
  })

  for (const a of appointments) {
    let proceduresCents = 0
    const procedures: ReceitaProcedure[] = []

    for (const p of a.procedures) {
      proceduresCents += toCents(p.totalPrice)
      procedures.push({
        procedureId: p.procedureId,
        // SNAPSHOT HISTÓRICO: o nome gravado no atendimento é preservado mesmo
        // que o catálogo mude depois. Nada aqui é relido de `procedures`.
        name: p.procedureNameSnapshot,
        quantity: p.quantity,
        unitPrice: roundMoney(p.unitPrice),
        totalPrice: roundMoney(p.totalPrice),
      })
    }

    const expectedCents =
      a.totalAmount == null ? proceduresCents : toCents(a.totalAmount)

    let receivedCents = 0
    for (const p of a.payments) {
      if (p.status === "refunded") continue
      receivedCents += toCents(p.amount)
    }

    map.set(a.id, {
      expectedTotal: fromCents(expectedCents),
      receivedTotal: fromCents(receivedCents),
      pendingTotal: fromCents(Math.max(expectedCents - receivedCents, 0)),
      patientId: a.patientId,
      patientName: a.patient.fullName,
      patientCpf: a.patient.cpf,
      patientPhone: a.patient.phone,
      appointmentStatus: a.status,
      professionalName: a.finishedByName,
      procedures,
    })
  }

  return map
}

// ---------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------

/**
 * Lista receitas com filtro de período, busca textual, filtros de status /
 * forma de pagamento / origem / profissional, ordenação e paginação — TUDO no
 * servidor.
 *
 * Os filtros que dependem de texto do paciente/atendimento são aplicados no
 * banco via `OR` sobre as relações, nunca baixando a base para filtrar em
 * memória.
 */
export async function listReceitas(
  options: ListReceitasOptions = {}
): Promise<ListReceitasResult> {
  const preset = options.period ?? "month"
  const { start, end } = resolvePeriodRange(preset, new Date(), {
    from: options.from,
    to: options.to,
  })

  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20)))
  const sort = options.sort ?? "date"
  const direction = options.direction ?? "desc"

  // ---- Busca textual -------------------------------------------------------
  // Resolvida no BANCO: nome do paciente, CPF, identificação do atendimento e
  // nome do procedimento (snapshot). A descrição da movimentação também entra.
  const search = (options.search ?? "").trim()
  const searchFilter =
    search.length > 0
      ? {
          OR: [
            { description: { contains: search } },
            { patient: { is: { fullName: { contains: search } } } },
            { patient: { is: { cpf: { contains: search } } } },
            { appointment: { is: { id: { contains: search } } } },
            { appointment: { is: { patient: { is: { fullName: { contains: search } } } } } },
            { appointment: { is: { patient: { is: { cpf: { contains: search } } } } } },
            {
              appointment: {
                is: {
                  procedures: {
                    some: { procedureNameSnapshot: { contains: search } },
                  },
                },
              },
            },
          ],
        }
      : {}

  // ---- Origem --------------------------------------------------------------
  // `schedule` = atendimento ainda "scheduled"; `appointment` = qualquer outro
  // status clínico; `manual` = receita sem atendimento (estrutura preparada).
  const originFilter =
    options.origin === "schedule"
      ? { appointment: { is: { status: "scheduled" } } }
      : options.origin === "appointment"
        ? { appointment: { is: { status: { not: "scheduled" } } } }
        : options.origin === "manual"
          ? { appointmentId: null }
          : {}

  // Status é DERIVADO (settled/partial dependem do saldo do atendimento), então
  // o filtro grosso é feito no banco e o refinamento em memória, sobre o
  // conjunto já filtrado pelo período/busca.
  const statusFilter =
    options.status === "settled" || options.status === "partial"
      ? { status: "settled" }
      : options.status
        ? { status: options.status }
        : {}

  const where = {
    direction: "in",
    ...(preset === "all" ? {} : { competenceDate: { gte: start, lte: end } }),
    ...(options.paymentMethod ? { paymentMethod: options.paymentMethod } : {}),
    ...(options.professionalName
      ? { appointment: { is: { finishedByName: { contains: options.professionalName } } } }
      : {}),
    ...searchFilter,
    ...originFilter,
    ...statusFilter,
  }

  const transactions = await prisma.financialTransaction.findMany({
    where,
    select: {
      id: true,
      paymentId: true,
      appointmentId: true,
      patientId: true,
      amount: true,
      status: true,
      competenceDate: true,
      settledAt: true,
      paymentMethod: true,
      description: true,
      createdAt: true,
      reversedAt: true,
      reverseReason: true,
      reversedByName: true,
      createdByName: true,
    },
    orderBy: { competenceDate: "desc" },
  })

  const contexts = await loadAppointmentContexts(
    transactions.map((t) => t.appointmentId).filter((id): id is string => Boolean(id))
  )

  const patientIds = [
    ...new Set(
      transactions
        .map(
          (t) =>
            t.patientId ??
            (t.appointmentId ? contexts.get(t.appointmentId)?.patientId : null)
        )
        .filter((id): id is string => Boolean(id))
    ),
  ]
  const patients =
    patientIds.length > 0
      ? await prisma.patient.findMany({
          where: { id: { in: patientIds } },
          select: { id: true, fullName: true, cpf: true, phone: true },
        })
      : []
  const patientMap = new Map(patients.map((p) => [p.id, p]))

  let items: ReceitaItem[] = transactions.map((t) => {
    const ctx = t.appointmentId ? contexts.get(t.appointmentId) : undefined
    const resolvedPatientId = t.patientId ?? ctx?.patientId ?? null
    const patient = resolvedPatientId ? patientMap.get(resolvedPatientId) : undefined

    const patientName =
      patient?.fullName ?? ctx?.patientName ?? "Sem paciente (receita manual)"
    const patientCpf = patient?.cpf ?? ctx?.patientCpf ?? null
    const patientPhone = patient?.phone ?? ctx?.patientPhone ?? null

    const pendingTotal = ctx?.pendingTotal ?? 0
    const status = deriveReceitaStatus(t.status, pendingTotal)
    const origin = deriveReceitaOrigin(ctx?.appointmentStatus ?? null)

    return {
      id: t.id,
      paymentId: t.paymentId,
      appointmentId: t.appointmentId,
      appointmentCode: appointmentCode(t.appointmentId),
      patientId: resolvedPatientId,
      patientName,
      patientCpf,
      patientPhone,
      origin,
      originLabel: receitaOriginLabel(origin),
      receivedAt: (t.settledAt ?? t.competenceDate)?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      amount: roundMoney(t.amount),
      expectedTotal: ctx?.expectedTotal ?? 0,
      receivedTotal: ctx?.receivedTotal ?? 0,
      pendingTotal,
      paymentMethod: t.paymentMethod,
      paymentMethodLabel: paymentMethodLabel(t.paymentMethod),
      status,
      statusLabel: receitaStatusLabel(status),
      professionalName: ctx?.professionalName ?? null,
      createdByName: t.createdByName ?? null,
      description: t.description,
      notes: t.reverseReason ?? null,
      procedures: ctx?.procedures ?? [],
      reversedAt: t.reversedAt?.toISOString() ?? null,
      reverseReason: t.reverseReason ?? null,
      reversedByName: t.reversedByName ?? null,
    }
  })

  // Quando o filtro pede "parcial", restringe aos settled com saldo em aberto.
  if (options.status === "partial") {
    items = items.filter((i) => i.status === "partial")
  }

  // ---- Resumo --------------------------------------------------------------
  // Calculado sobre TODAS as linhas filtradas (antes da paginação).
  let receivedCents = 0
  let pendingCents = 0
  let receivedCount = 0
  let pendingCount = 0
  let partialCount = 0

  for (const item of items) {
    if (item.status === "settled" || item.status === "partial") {
      receivedCents += toCents(item.amount)
      receivedCount++
      if (item.status === "partial") partialCount++
      pendingCents += toCents(item.pendingTotal)
    } else if (item.status === "pending") {
      pendingCount++
      pendingCents += toCents(item.amount)
    }
    // cancelled / reversed: fora de todos os totais.
  }

  // "Recebido hoje" é sempre o dia corrente, independente do período filtrado.
  const todayRange = resolvePeriodRange("today", new Date())
  const todayAgg = await prisma.financialTransaction.aggregate({
    where: {
      direction: "in",
      status: "settled",
      competenceDate: { gte: todayRange.start, lte: todayRange.end },
    },
    _sum: { amount: true },
  })

  const totalReceived = fromCents(receivedCents)
  const summary: ReceitasSummary = {
    totalReceived,
    receivedCount,
    averageTicket:
      receivedCount > 0 ? roundMoney(totalReceived / receivedCount) : 0,
    receivedToday: roundMoney(todayAgg._sum.amount ?? 0),
    totalPending: fromCents(pendingCents),
    pendingCount,
    partialCount,
    totalCount: items.length,
  }

  // ---- Ordenação -----------------------------------------------------------
  const factor = direction === "asc" ? 1 : -1
  items.sort((a, b) => {
    if (sort === "amount") return (toCents(a.amount) - toCents(b.amount)) * factor
    if (sort === "patient") return a.patientName.localeCompare(b.patientName) * factor
    const aTime = a.receivedAt ? Date.parse(a.receivedAt) : Date.parse(a.createdAt)
    const bTime = b.receivedAt ? Date.parse(b.receivedAt) : Date.parse(b.createdAt)
    return (aTime - bTime) * factor
  })

  // ---- Paginação -----------------------------------------------------------
  const totalCount = items.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const safePage = Math.min(page, totalPages)
  const skip = (safePage - 1) * pageSize
  const pageItems = items.slice(skip, skip + pageSize)

  return {
    receitas: pageItems,
    summary,
    pagination: {
      page: safePage,
      pageSize,
      totalPages,
      totalCount,
      hasPrevious: safePage > 1,
      hasNext: safePage < totalPages,
      from: totalCount === 0 ? 0 : skip + 1,
      to: Math.min(skip + pageSize, totalCount),
    },
    period: {
      preset,
      from: start.toISOString(),
      to: end.toISOString(),
    },
  }
}

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

export interface ReceitaPaymentEntry {
  id: string
  amount: number
  paymentMethod: string
  paymentMethodLabel: string
  status: string
  paidAt: string | null
  createdAt: string
  isCurrent: boolean
}

export interface ReceitaDetail extends ReceitaItem {
  /** Pagamentos individuais do atendimento (histórico completo, preservado). */
  payments: ReceitaPaymentEntry[]
  appointmentDate: string | null
  appointmentTime: string | null
  appointmentStatus: string | null
}

/**
 * Detalhe de UMA receita. Aceita o id da movimentação OU o id do pagamento,
 * para que um link antigo continue funcionando.
 */
export async function getReceitaDetail(id: string): Promise<ReceitaDetail | null> {
  const target = await prisma.financialTransaction.findFirst({
    where: { direction: "in", OR: [{ id }, { paymentId: id }] },
    select: { id: true, appointmentId: true },
  })

  if (!target) return null

  return buildReceitaDetail(target.id, target.appointmentId)
}

async function buildReceitaDetail(
  transactionId: string,
  appointmentId: string | null
): Promise<ReceitaDetail | null> {
  const t = await prisma.financialTransaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      paymentId: true,
      appointmentId: true,
      patientId: true,
      amount: true,
      status: true,
      competenceDate: true,
      settledAt: true,
      paymentMethod: true,
      description: true,
      createdAt: true,
      reversedAt: true,
      reverseReason: true,
      reversedByName: true,
      createdByName: true,
    },
  })
  if (!t) return null

  const contexts = await loadAppointmentContexts(appointmentId ? [appointmentId] : [])
  const ctx = appointmentId ? contexts.get(appointmentId) : undefined

  const resolvedPatientId = t.patientId ?? ctx?.patientId ?? null
  const patient = resolvedPatientId
    ? await prisma.patient.findUnique({
        where: { id: resolvedPatientId },
        select: { fullName: true, cpf: true, phone: true },
      })
    : null

  const appointment = appointmentId
    ? await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          appointmentDate: true,
          appointmentTime: true,
          status: true,
          payments: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              amount: true,
              paymentMethod: true,
              status: true,
              paidAt: true,
              createdAt: true,
            },
          },
        },
      })
    : null

  const pendingTotal = ctx?.pendingTotal ?? 0
  const status = deriveReceitaStatus(t.status, pendingTotal)
  const origin = deriveReceitaOrigin(ctx?.appointmentStatus ?? null)

  return {
    id: t.id,
    paymentId: t.paymentId,
    appointmentId: t.appointmentId,
    appointmentCode: appointmentCode(t.appointmentId),
    patientId: resolvedPatientId,
    patientName:
      patient?.fullName ?? ctx?.patientName ?? "Sem paciente (receita manual)",
    patientCpf: patient?.cpf ?? ctx?.patientCpf ?? null,
    patientPhone: patient?.phone ?? ctx?.patientPhone ?? null,
    origin,
    originLabel: receitaOriginLabel(origin),
    receivedAt: (t.settledAt ?? t.competenceDate)?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    amount: roundMoney(t.amount),
    expectedTotal: ctx?.expectedTotal ?? 0,
    receivedTotal: ctx?.receivedTotal ?? 0,
    pendingTotal,
    paymentMethod: t.paymentMethod,
    paymentMethodLabel: paymentMethodLabel(t.paymentMethod),
    status,
    statusLabel: receitaStatusLabel(status),
    professionalName: ctx?.professionalName ?? null,
    createdByName: t.createdByName ?? null,
    description: t.description,
    notes: t.reverseReason ?? null,
    procedures: ctx?.procedures ?? [],
    reversedAt: t.reversedAt?.toISOString() ?? null,
    reverseReason: t.reverseReason ?? null,
    reversedByName: t.reversedByName ?? null,
    appointmentDate: appointment?.appointmentDate.toISOString() ?? null,
    appointmentTime: appointment?.appointmentTime ?? null,
    appointmentStatus: appointment?.status ?? null,
    payments: (appointment?.payments ?? []).map((p) => ({
      id: p.id,
      amount: roundMoney(p.amount),
      paymentMethod: p.paymentMethod,
      paymentMethodLabel: paymentMethodLabel(p.paymentMethod),
      status: p.status,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      isCurrent: p.id === t.paymentId,
    })),
  }
}

// ---------------------------------------------------------------------------
// Registro de recebimento
// ---------------------------------------------------------------------------
// Delega ao serviço canônico de pagamentos. Este serviço NÃO cria pagamento por
// conta própria — não existe um segundo caminho.

export async function registerReceita(data: {
  appointmentId: string
  amount: number
  paymentMethod: string
  actorName?: string
}) {
  const result = await registerPaymentForAppointment({
    appointmentId: data.appointmentId,
    amount: data.amount,
    paymentMethod: data.paymentMethod,
    actorName: data.actorName,
  })

  return {
    paymentId: result.payment.id,
    appointmentId: result.payment.appointmentId,
    amount: result.payment.amount,
    paymentMethod: result.payment.paymentMethod,
    paymentMethodLabel: paymentMethodLabel(result.payment.paymentMethod),
    status: result.payment.status,
    paidAt: result.payment.paidAt?.toISOString() ?? null,
    pendingBefore: result.pendingBefore,
    pendingAfter: result.pendingAfter,
    appointmentStatus: result.appointmentStatus,
    actorName: normalizeActorName(data.actorName),
  }
}

// ---------------------------------------------------------------------------
// Estorno
// ---------------------------------------------------------------------------
// NÃO apaga nada. A receita estornada permanece no histórico, marcada, e sai de
// todos os totais (o domínio exclui `reversed` de qualquer soma).

export async function reverseReceita(data: {
  id: string
  reason?: string | null
  actorName?: string
}): Promise<ReceitaDetail | null> {
  const target = await prisma.financialTransaction.findFirst({
    where: { direction: "in", OR: [{ id: data.id }, { paymentId: data.id }] },
    select: { id: true, paymentId: true, appointmentId: true },
  })
  if (!target) return null

  await prisma.financialTransaction.update({
    where: { id: target.id },
    data: {
      status: "reversed",
      reversedAt: new Date(),
      reverseReason: (data.reason ?? "").trim() || null,
      reversedByName: normalizeActorName(data.actorName),
    },
  })

  // O pagamento de origem também passa a "refunded", mantendo as duas camadas
  // coerentes. O registro NÃO é removido.
  if (target.paymentId) {
    await prisma.payment.update({
      where: { id: target.paymentId },
      data: { status: "refunded" },
    })
  }

  return buildReceitaDetail(target.id, target.appointmentId)
}

// ===========================================================================
// SERVIÇO DE CONTAS A RECEBER — módulo Financeiro (Financeiro 3).
// ===========================================================================
//
// O QUE ESTE SERVIÇO É
//
// A leitura da COBRANÇA: quanto foi cobrado, quanto já entrou e quanto ainda
// falta receber, por atendimento. É a perspectiva do SALDO, complementar à
// perspectiva do RECEBIMENTO (Financeiro 2 — Receitas).
//
// AS TRÊS PERSPECTIVAS (nunca somadas entre si)
//
//   Previsto   -> quanto o atendimento DEVERIA render (cobrança)
//   Recebido   -> quanto efetivamente entrou (pagamentos válidos)
//   Saldo      -> previsto - recebido (o que ainda falta)
//
// Receitas responde "quanto entrou"; Contas a Receber responde "quanto falta".
// Um atendimento de R$ 1.000 com R$ 400 pagos aparece nas duas telas: com
// R$ 400 como receita e com R$ 600 como saldo. NUNCA como R$ 1.000 recebido.
//
// FONTE DA VERDADE (e por que não há duplicação)
//
//   Appointment + AppointmentProcedure  ->  previsto
//   Payment                             ->  recebido
//
// Este serviço NÃO possui tabela própria. Ele é uma PROJEÇÃO calculada sobre as
// fontes existentes. A única escrita que dispara é o registro de um pagamento —
// e ela sempre passa pelo serviço canônico `registerPaymentForAppointment`
// (`financial-payments-service.ts`), a mesma porta usada por Receitas. Não
// existe um segundo caminho para criar pagamento.
//
// REGRAS FINANCEIRAS
//
//   previsto = appointments.total_amount ?? soma(appointment_procedures.total_price)
//   recebido = soma(payments.amount WHERE status != 'refunded')
//   saldo    = max(previsto - recebido, 0)
//
// Um pagamento estornado (`refunded`) NÃO conta como recebido: ele devolve o
// valor ao saldo, mas o registro permanece (nada é apagado).
//
// O QUE NÃO CONTA COMO CONTA A RECEBER
//
//   - atendimento cancelado     -> histórico, fora de todos os totais
//   - atendimento sem cobrança  -> previsto = 0 e recebido = 0
//   - atendimento quitado       -> saldo = 0, entra só no contador
//
// ISOLAMENTO (single-tenant)
//
// Não há autenticação/RBAC nesta fase (decisão 3-A). `professionalName` e
// `actorName` são ATRIBUIÇÃO textual ("quem fez"), não identidade de acesso. O
// paciente NUNCA é aceito do cliente: é sempre derivado do atendimento.

import { prisma } from "@/lib/prisma"
import {
  fromCents,
  paymentMethodLabel,
  resolvePeriodRange,
  roundMoney,
  toCents,
  toDayKey,
} from "@/lib/financial-domain"
import { registerPaymentForAppointment } from "@/lib/financial-payments-service"
import { normalizeActorName } from "@/lib/financial-service"

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
// O status é DERIVADO no servidor a partir do saldo e do vencimento — nunca
// gravado. A ordem das regras importa: cancelado vence tudo; quitado não pode
// ser "vencido"; e "vencido" exige saldo em aberto.

export const ACCOUNT_STATUSES = [
  "EM_ABERTO", // saldo > 0, vencimento hoje ou no futuro, nada recebido
  "PARCIAL", // saldo > 0, vencimento no prazo, já houve recebimento
  "VENCIDO", // saldo > 0 e vencimento no passado
  "QUITADO", // saldo == 0
  "CANCELADO", // atendimento cancelado — fora de todos os totais
] as const

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  EM_ABERTO: "Em aberto",
  PARCIAL: "Parcial",
  VENCIDO: "Vencido",
  QUITADO: "Quitado",
  CANCELADO: "Cancelado",
}

export function accountStatusLabel(status: string): string {
  return ACCOUNT_STATUS_LABELS[status as AccountStatus] ?? status
}

/**
 * Status de uma conta a receber.
 *
 * PRECEDÊNCIA (nesta ordem, e por um motivo):
 *   1. CANCELADO — atendimento cancelado nunca é cobrável;
 *   2. QUITADO   — saldo zero encerra a conta, mesmo com vencimento passado;
 *   3. VENCIDO   — saldo em aberto com vencimento anterior a hoje;
 *   4. PARCIAL   — houve recebimento, mas ainda há saldo;
 *   5. EM_ABERTO — nada recebido, ainda dentro do prazo.
 *
 * `receivedAmount` é usado APENAS para distinguir PARCIAL de EM_ABERTO. O
 * vencimento é comparado por DIA, não por instante: uma conta que vence hoje
 * NÃO está vencida.
 */
export function deriveAccountStatus(params: {
  /** Atendimento cancelado é histórico: fora de qualquer total. */
  appointmentStatus: string
  /** Saldo em aberto (já limitado a >= 0). */
  balance: number
  /** Quanto já foi recebido — distingue PARCIAL de EM_ABERTO. */
  receivedAmount: number
  /** Data de vencimento (dia local). */
  dueDate: string | Date
  /** Data de referência (padrão: hoje). */
  referenceDate?: Date
}): AccountStatus {
  const { appointmentStatus, balance, receivedAmount, dueDate } = params

  if (appointmentStatus === "cancelled") return "CANCELADO"
  if (balance <= 0) return "QUITADO"

  const reference = params.referenceDate ?? new Date()
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate)

  // Comparação por DIA: vencimento hoje ainda está no prazo.
  if (toDayKey(due) < toDayKey(reference)) return "VENCIDO"
  if (receivedAmount > 0) return "PARCIAL"
  return "EM_ABERTO"
}

// ---------------------------------------------------------------------------
// Tipos de saída (contrato consumido pela API e pela tela)
// ---------------------------------------------------------------------------

export interface ContaReceberProcedure {
  procedureId: string | null
  /** Nome no momento do atendimento (snapshot histórico). */
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface ContaReceberPayment {
  id: string
  amount: number
  paymentMethod: string
  paymentMethodLabel: string
  status: string
  paidAt: string | null
  createdAt: string
}

export interface ContaReceberItem {
  /** Identificador da conta = identificador do ATENDIMENTO (link estável). */
  id: string
  appointmentId: string
  /** Código curto do atendimento (ex.: "A1B2C3D4"). */
  appointmentCode: string
  appointmentDate: string
  appointmentTime: string
  appointmentStatus: string

  patientId: string
  patientName: string
  patientCpf: string | null
  patientPhone: string | null

  professionalName: string | null

  /** Data em que a cobrança foi registrada (criação do atendimento). */
  chargedAt: string
  /** Vencimento — a data que define "vencido" nesta tela. */
  dueDate: string
  /** Dias até o vencimento (negativo = vencido). */
  daysUntilDue: number

  /** Quanto foi cobrado (previsto). */
  expectedAmount: number
  /** Quanto já entrou (pagamentos não estornados). */
  receivedAmount: number
  /** O que falta receber — o número protagonista da tela. */
  balance: number

  status: AccountStatus
  statusLabel: string

  procedures: ContaReceberProcedure[]
  /** Histórico completo de pagamentos do atendimento (nada é apagado). */
  payments: ContaReceberPayment[]

  lastPayment: {
    paidAt: string | null
    amount: number
    paymentMethod: string
    paymentMethodLabel: string
  } | null
}

export interface ContasReceberSummary {
  /** Soma dos saldos de TODAS as contas não quitadas e não canceladas. */
  totalBalance: number
  /** Saldo com vencimento anterior a hoje. */
  overdueBalance: number
  /** Saldo com vencimento HOJE. */
  dueTodayBalance: number
  /** Saldo com vencimento futuro. */
  upcomingBalance: number
  /** Saldo das contas que já receberam algo (parciais ou vencidas). */
  partialBalance: number

  /** Total previsto das contas consideradas (contexto — não é receita). */
  totalExpected: number
  /** Total recebido das contas consideradas (contexto — não é receita). */
  totalReceived: number

  /** Quantidade de contas após filtros (antes da paginação). */
  totalCount: number
  openCount: number
  overdueCount: number
  dueTodayCount: number
  partialCount: number
  settledCount: number
  cancelledCount: number
}

export interface ListContasReceberOptions {
  period?: string
  from?: string
  to?: string
  status?: string
  search?: string
  patientName?: string
  patientCpf?: string
  procedureName?: string
  professionalName?: string
  minAmount?: number
  maxAmount?: number
  sort?: "dueDate" | "balance" | "patient" | "expected"
  direction?: "asc" | "desc"
  page?: number
  pageSize?: number
}

export interface ListContasReceberResult {
  contas: ContaReceberItem[]
  summary: ContasReceberSummary
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
// Carregamento (uma consulta por lote — sem N+1)
// ---------------------------------------------------------------------------

const APPOINTMENT_SELECT = {
  id: true,
  appointmentDate: true,
  appointmentTime: true,
  status: true,
  totalAmount: true,
  finishedByName: true,
  createdAt: true,
  patientId: true,
  patient: {
    select: { id: true, fullName: true, cpf: true, phone: true },
  },
  procedures: {
    select: {
      procedureId: true,
      procedureNameSnapshot: true,
      quantity: true,
      unitPrice: true,
      totalPrice: true,
    },
  },
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
} as const

async function fetchAppointments(where: Record<string, unknown>) {
  return prisma.appointment.findMany({
    where,
    select: APPOINTMENT_SELECT,
    orderBy: { appointmentDate: "asc" },
  })
}

type AppointmentRow = Awaited<ReturnType<typeof fetchAppointments>>[number]

/**
 * Transforma um atendimento na conta a receber correspondente.
 *
 * NÃO consulta o banco: todo o contexto já vem carregado em lote. Era aqui que
 * a versão anterior abria um N+1 (três consultas por atendimento).
 */
function buildConta(appt: AppointmentRow, reference: Date): ContaReceberItem | null {
  let proceduresCents = 0
  const procedures: ContaReceberProcedure[] = []

  for (const p of appt.procedures) {
    proceduresCents += toCents(p.totalPrice)
    procedures.push({
      procedureId: p.procedureId,
      // SNAPSHOT HISTÓRICO: o nome gravado no atendimento é preservado mesmo
      // que o catálogo mude depois.
      name: p.procedureNameSnapshot,
      quantity: p.quantity,
      unitPrice: roundMoney(p.unitPrice),
      totalPrice: roundMoney(p.totalPrice),
    })
  }

  const expectedCents =
    appt.totalAmount == null ? proceduresCents : toCents(appt.totalAmount)

  let receivedCents = 0
  const payments: ContaReceberPayment[] = []

  for (const p of appt.payments) {
    // Estorno NÃO é recebimento — o valor volta ao saldo. O registro fica.
    if (p.status === "refunded") continue
    receivedCents += toCents(p.amount)
    payments.push({
      id: p.id,
      amount: roundMoney(p.amount),
      paymentMethod: p.paymentMethod,
      paymentMethodLabel: paymentMethodLabel(p.paymentMethod),
      status: p.status,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })
  }

  // Sem cobrança e sem recebimento: não há conta a receber a exibir.
  if (expectedCents <= 0 && receivedCents <= 0) return null

  const expectedAmount = fromCents(expectedCents)
  const receivedAmount = fromCents(receivedCents)
  const balance = fromCents(Math.max(expectedCents - receivedCents, 0))

  const dueDate = new Date(appt.appointmentDate)
  const status = deriveAccountStatus({
    appointmentStatus: appt.status,
    balance,
    receivedAmount,
    dueDate,
    referenceDate: reference,
  })

  const dayMs = 24 * 60 * 60 * 1000
  const dueDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
  const todayDay = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate()
  )
  const daysUntilDue = Math.round((dueDay.getTime() - todayDay.getTime()) / dayMs)

  // Pagamentos já vêm ordenados por criação (desc) — o mais recente é o [0].
  const latest = payments[0] ?? null

  return {
    id: appt.id,
    appointmentId: appt.id,
    appointmentCode: appt.id.slice(-8).toUpperCase(),
    appointmentDate: appt.appointmentDate.toISOString(),
    appointmentTime: appt.appointmentTime,
    appointmentStatus: appt.status,

    patientId: appt.patientId,
    patientName: appt.patient.fullName,
    patientCpf: appt.patient.cpf,
    patientPhone: appt.patient.phone,

    professionalName: appt.finishedByName,

    chargedAt: appt.createdAt.toISOString(),
    dueDate: dueDate.toISOString(),
    daysUntilDue,

    expectedAmount,
    receivedAmount,
    balance,

    status,
    statusLabel: accountStatusLabel(status),

    procedures,
    payments,
    lastPayment: latest
      ? {
          paidAt: latest.paidAt,
          amount: latest.amount,
          paymentMethod: latest.paymentMethod,
          paymentMethodLabel: latest.paymentMethodLabel,
        }
      : null,
  }
}

/**
 * Consolida os totais das contas INFORMADAS. Função pura: recebe o conjunto
 * já materializado e não conhece período, busca nem paginação.
 *
 * REGRA DOS BALDES: vencido, hoje e futuro são DISJUNTOS e cobrem todo o
 * saldo em aberto (`overdue + dueToday + upcoming === totalBalance`).
 * `partialBalance` é um corte TRANSVERSAL — conta o saldo de quem já pagou
 * algo, então pode se sobrepor a `overdueBalance` e a `dueTodayBalance`.
 * Cancelado fica fora de TODOS os totais, inclusive dos contextuais.
 */
function buildSummary(
  contas: ContaReceberItem[],
  reference: Date
): ContasReceberSummary {
  const todayKey = toDayKey(reference)

  let totalBalanceCents = 0
  let overdueCents = 0
  let dueTodayCents = 0
  let upcomingCents = 0
  let partialCents = 0
  let totalExpectedCents = 0
  let totalReceivedCents = 0

  let openCount = 0
  let overdueCount = 0
  let dueTodayCount = 0
  let partialCount = 0
  let settledCount = 0
  let cancelledCount = 0

  for (const c of contas) {
    if (c.status === "CANCELADO") {
      cancelledCount++
      // Cancelado fica fora de TODOS os totais — inclusive dos contextuais.
      continue
    }

    totalExpectedCents += toCents(c.expectedAmount)
    totalReceivedCents += toCents(c.receivedAmount)

    if (c.status === "QUITADO") {
      settledCount++
      continue
    }

    // A partir daqui: saldo > 0.
    const cents = toCents(c.balance)
    totalBalanceCents += cents

    const dueKey = toDayKey(new Date(c.dueDate))
    if (dueKey < todayKey) {
      overdueCents += cents
      overdueCount++
      // Uma conta vencida COM recebimento também é parcial.
      if (c.receivedAmount > 0) {
        partialCents += cents
        partialCount++
      }
      openCount++
    } else if (dueKey === todayKey) {
      dueTodayCents += cents
      dueTodayCount++
      if (c.receivedAmount > 0) {
        partialCents += cents
        partialCount++
      }
      openCount++
    } else {
      upcomingCents += cents
      openCount++
      if (c.status === "PARCIAL") {
        partialCents += cents
        partialCount++
      }
    }
  }

  return {
    totalBalance: fromCents(totalBalanceCents),
    overdueBalance: fromCents(overdueCents),
    dueTodayBalance: fromCents(dueTodayCents),
    upcomingBalance: fromCents(upcomingCents),
    partialBalance: fromCents(partialCents),
    totalExpected: fromCents(totalExpectedCents),
    totalReceived: fromCents(totalReceivedCents),
    totalCount: contas.length,
    openCount,
    overdueCount,
    dueTodayCount,
    partialCount,
    settledCount,
    cancelledCount,
  }
}

/**
 * Lista contas a receber com filtros avançados, busca e paginação.
 *
 * PERÍODO: refere-se à DATA DE VENCIMENTO (vencimento), não à data de cobrança
 * ou pagamento. Este é o conceito principal de "Contas a Receber".
 */
export async function listContasReceber(
  options: ListContasReceberOptions = {}
): Promise<ListContasReceberResult> {
  const preset = options.period ?? "month"
  const { start, end } = resolvePeriodRange(preset, new Date(), {
    from: options.from,
    to: options.to,
  })

  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20)))
  const sort = options.sort ?? "dueDate"
  const direction = options.direction ?? "desc"

  const reference = new Date()

  // ---- Filtro no banco -----------------------------------------------------
  // Só o que é filtrável em SQL desce para o banco. `cancelled` é excluído
  // quando o filtro pede algo diferente dele: um atendimento cancelado nunca
  // compõe saldo. Quando o filtro pede "CANCELADO", ele é o único conjunto.
  const statusWanted = options.status
  const appointmentStatusFilter =
    statusWanted === "CANCELADO"
      ? { status: "cancelled" }
      : statusWanted
        ? { status: { not: "cancelled" } }
        : {}

  const search = (options.search ?? "").trim()
  const searchFilter =
    search.length > 0
      ? {
          OR: [
            { id: { contains: search } },
            { patient: { is: { fullName: { contains: search } } } },
            { patient: { is: { cpf: { contains: search } } } },
            { procedures: { some: { procedureNameSnapshot: { contains: search } } } },
          ],
        }
      : {}

  const where = {
    ...(preset === "all" ? {} : { appointmentDate: { gte: start, lte: end } }),
    ...(options.professionalName
      ? { finishedByName: { contains: options.professionalName } }
      : {}),
    ...appointmentStatusFilter,
    ...searchFilter,
  }

  const appointments = await fetchAppointments(where)

  // ---- Construção e filtros em memória ------------------------------------
  // Os filtros abaixo dependem de valores DERIVADOS (saldo, status), que não
  // existem no banco: por isso são aplicados aqui, sobre o conjunto já reduzido
  // pelo período e pela busca.
  const contas: ContaReceberItem[] = []

  for (const appt of appointments) {
    const conta = buildConta(appt, reference)
    if (!conta) continue

    if (options.patientName) {
      const q = options.patientName.toLowerCase().trim()
      if (!conta.patientName.toLowerCase().includes(q)) continue
    }

    if (options.patientCpf) {
      const q = options.patientCpf.replace(/\D/g, "")
      const cpf = conta.patientCpf?.replace(/\D/g, "") ?? ""
      if (q.length === 0 || !cpf.includes(q)) continue
    }

    if (options.procedureName) {
      const q = options.procedureName.toLowerCase().trim()
      if (!conta.procedures.some((p) => p.name.toLowerCase().includes(q))) continue
    }

    // Faixa de valor filtra pelo SALDO — é o número que o usuário vê.
    if (options.minAmount !== undefined && conta.balance < options.minAmount) continue
    if (options.maxAmount !== undefined && conta.balance > options.maxAmount) continue

    if (statusWanted && conta.status !== statusWanted) continue

    contas.push(conta)
  }

  // ---- Ordenação ----------------------------------------------------------
  // Vencido primeiro, depois em aberto/parcial, quitado e cancelado por último
  // — a ordem de urgência que a recepção usa no dia a dia. Quitado e cancelado
  // são HISTÓRICO, não trabalho pendente: ficam no fim mesmo quando a ordenação
  // pedida é por valor.
  const RANK: Record<AccountStatus, number> = {
    VENCIDO: 0,
    EM_ABERTO: 1,
    PARCIAL: 1,
    QUITADO: 2,
    CANCELADO: 3,
  }

  const factor = direction === "asc" ? 1 : -1

  contas.sort((a, b) => {
    const rankDiff = RANK[a.status] - RANK[b.status]
    if (rankDiff !== 0) return rankDiff

    if (sort === "balance") return (toCents(a.balance) - toCents(b.balance)) * factor
    if (sort === "expected")
      return (toCents(a.expectedAmount) - toCents(b.expectedAmount)) * factor
    if (sort === "patient") return a.patientName.localeCompare(b.patientName) * factor

    return a.dueDate.localeCompare(b.dueDate) * factor
  })

  // ---- Resumo (sobre o conjunto COMPLETO, antes de paginar) ----------------
  const summary = buildSummary(contas, reference)

  // ---- Paginação ----------------------------------------------------------
  const totalCount = contas.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const safePage = Math.min(page, totalPages)
  const skip = (safePage - 1) * pageSize
  const pageItems = contas.slice(skip, skip + pageSize)

  return {
    contas: pageItems,
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

/**
 * Detalhe de UMA conta a receber, pelo identificador do ATENDIMENTO.
 * Devolve null (sem lançar) quando não existe ou não há cobrança.
 */
export async function getContaReceberDetail(
  appointmentId: string
): Promise<ContaReceberItem | null> {
  if (!appointmentId || appointmentId.trim() === "") return null

  const appointments = await fetchAppointments({ id: appointmentId })
  if (appointments.length === 0) return null

  return buildConta(appointments[0], new Date())
}

// ---------------------------------------------------------------------------
// Registro de recebimento
// ---------------------------------------------------------------------------

export interface RegisterContaPaymentInput {
  appointmentId: string
  amount: number
  paymentMethod: string
  actorName?: string
  /** Data efetiva do recebimento. Ausente = agora. */
  paidAt?: Date
}

export interface RegisterContaPaymentResult {
  paymentId: string
  appointmentId: string
  amount: number
  paymentMethod: string
  paymentMethodLabel: string
  paidAt: string | null

  /** Saldo antes e depois — o cliente não precisa recalcular nada. */
  balanceBefore: number
  balanceAfter: number

  status: AccountStatus
  statusLabel: string
  appointmentStatus: string
  actorName: string
}

/**
 * Registra um recebimento (parcial ou total) contra uma conta.
 *
 * Delega ao serviço canônico de pagamentos — a MESMA porta usada pela Agenda e
 * por Receitas. Não existe um segundo caminho para criar pagamento, e o saldo
 * excedente é recusado pelo próprio serviço canônico (`EXCEEDS_PENDING`).
 *
 * Um atendimento CANCELADO não é reaberto: o serviço canônico preserva o
 * status, e `getContaReceberDetail` continua classificando a conta como
 * CANCELADO (fora dos totais).
 */
export async function registerContaPayment(
  input: RegisterContaPaymentInput
): Promise<RegisterContaPaymentResult> {
  const before = await getContaReceberDetail(input.appointmentId)

  // O saldo é conferido pelo serviço canônico; aqui só registramos o ponto de
  // partida para devolver o "antes/depois" pronto para a interface.
  const balanceBefore = before?.balance ?? 0

  const result = await registerPaymentForAppointment({
    appointmentId: input.appointmentId,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    actorName: input.actorName,
    paidAt: input.paidAt,
  })

  const after = await getContaReceberDetail(input.appointmentId)
  const balanceAfter = after?.balance ?? 0

  return {
    paymentId: result.payment.id,
    appointmentId: result.payment.appointmentId,
    amount: roundMoney(result.payment.amount),
    paymentMethod: result.payment.paymentMethod,
    paymentMethodLabel: paymentMethodLabel(result.payment.paymentMethod),
    paidAt: result.payment.paidAt?.toISOString() ?? null,

    balanceBefore,
    balanceAfter,

    status: after?.status ?? "EM_ABERTO",
    statusLabel: accountStatusLabel(after?.status ?? "EM_ABERTO"),
    appointmentStatus: result.appointmentStatus,
    actorName: normalizeActorName(input.actorName),
  }
}

// ---------------------------------------------------------------------------
// Resumo (atalho para os cards)
// ---------------------------------------------------------------------------

export async function getContasReceberSummary(
  options: ListContasReceberOptions = {}
): Promise<ContasReceberSummary> {
  // O resumo responde "quanto tenho a receber AGORA?" — por isso ele NÃO
  // herda o período da listagem. Se herdasse, uma cobrança vencida no mês
  // passado desapareceria do card "Vencido" ao filtrar o mês atual, que é
  // exatamente o número mais urgente da tela. Os demais filtros (busca,
  // paciente, profissional, status) continuam valendo, para que o resumo
  // descreva o mesmo recorte do usuário.
  const { summary } = await listContasReceber({ ...options, period: "all" })
  return summary
}

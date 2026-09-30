// ===========================================================================
// SCHEMAS DE VALIDAÇÃO — módulo Financeiro (Parte 11 — Financeiro 1).
// ===========================================================================
// Validação de ENTRADA do cliente. Nenhum schema aqui define QUEM o usuário é:
// identidade é atribuição textual (`actorName`), não autenticação.
//
// Regra de segurança repetida nas rotas: o paciente NUNCA é definido pelo
// payload como critério de acesso. `patientId` só é aceito como contexto
// EXPLÍCITO de despesa avulsa, e sempre confrontado com o servidor quando
// houver `appointmentId`.

import { z } from "zod"
import { EXPENSE_KINDS, INSURANCE_PLAN_KINDS, PERIOD_PRESETS } from "@/lib/financial-domain"

// ---------------------------------------------------------------------------
// Comuns
// ---------------------------------------------------------------------------

/** Data "YYYY-MM-DD". */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD")

/**
 * Nome do responsável (ATRIBUIÇÃO, não autenticação).
 * Opcional: o backend grava "Não informado" quando ausente.
 */
const actorName = z.string().trim().max(120).optional()

const money = z
  .number({ message: "Valor deve ser um número" })
  .finite("Valor inválido")
  .positive("Valor deve ser maior que zero")
  .max(100_000_000, "Valor acima do limite permitido")

// ---------------------------------------------------------------------------
// Filtro de período do Dashboard
// ---------------------------------------------------------------------------

export const financialPeriodSchema = z.object({
  period: z.enum(PERIOD_PRESETS).default("month"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export type FinancialPeriodInput = z.infer<typeof financialPeriodSchema>

/** Lê o período a partir dos searchParams (nunca lança: cai para o padrão). */
export function parsePeriodFromSearchParams(searchParams: URLSearchParams): {
  preset: string
  from?: string
  to?: string
} {
  const rawPeriod = searchParams.get("period") ?? "month"
  const preset = (PERIOD_PRESETS as readonly string[]).includes(rawPeriod)
    ? rawPeriod
    : "month"

  const from = searchParams.get("from") ?? undefined
  const to = searchParams.get("to") ?? undefined

  const validDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)

  return {
    preset: preset === "custom" && (!validDate(from) || !validDate(to)) ? "month" : preset,
    from: validDate(from),
    to: validDate(to),
  }
}

// ---------------------------------------------------------------------------
// Categoria de despesa
// ---------------------------------------------------------------------------

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(2, "Nome deve ter no mínimo 2 caracteres").max(80),
  kind: z.enum(EXPENSE_KINDS),
})

// ---------------------------------------------------------------------------
// Despesa
// ---------------------------------------------------------------------------

export const createExpenseSchema = z.object({
  categoryId: z.string().min(1, "Categoria é obrigatória"),
  description: z.string().trim().min(2, "Descrição é obrigatória").max(200),
  supplier: z.string().trim().max(160).optional().nullable(),
  amount: money,
  competenceDate: dateOnly,
  dueDate: dateOnly.optional().nullable(),
  appointmentId: z.string().min(1).optional().nullable(),
  patientId: z.string().min(1).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  paymentMethod: z.string().trim().max(40).optional().nullable(),
  documentNumber: z.string().trim().max(60).optional().nullable(),
  isRecurring: z.boolean().optional(),
  markAsPaid: z.boolean().optional(),
  actorName,
})

export type CreateExpensePayload = z.infer<typeof createExpenseSchema>

/** Alias canônico (mesmo schema, nome do domínio consolidado). */
export const createDespesaSchema = createExpenseSchema
export type CreateDespesaPayload = CreateExpensePayload

export const updateExpenseSchema = z.object({
  description: z.string().trim().min(2).max(200).optional(),
  supplier: z.string().trim().max(160).optional().nullable(),
  amount: money.optional(),
  competenceDate: dateOnly.optional(),
  dueDate: dateOnly.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  documentNumber: z.string().trim().max(60).optional().nullable(),
  isRecurring: z.boolean().optional(),
  actorName,
})

export type UpdateExpensePayload = z.infer<typeof updateExpenseSchema>

/** Alias canônico (mesmo schema, nome do domínio consolidado). */
export const updateDespesaSchema = updateExpenseSchema
export type UpdateDespesaPayload = UpdateExpensePayload

export const payExpenseSchema = z.object({
  paymentMethod: z.string().trim().max(40).optional().nullable(),
  actorName,
})

/**
 * Pagamento de despesa (canônico): aceita valor (parcial ou total), método,
 * data e observação. `expenseId` vem do corpo ou do payload `id` da rota.
 */
export const registerDespesaPaymentSchema = z.object({
  expenseId: z.string().min(1, "Identificador da despesa é obrigatório").optional(),
  amount: money,
  paymentMethod: z.string().trim().min(1, "Método de pagamento é obrigatório").max(40),
  paidAt: dateOnly.optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  actorName,
})

export type RegisterDespesaPaymentPayload = z.infer<typeof registerDespesaPaymentSchema>

export const cancelExpenseSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
  actorName,
})

/** Alias canônico (mesmo schema, nome do domínio consolidado). */
export const cancelDespesaSchema = cancelExpenseSchema

/** Schema canônico de listagem/paginação de despesas. */
export const listDespesasSchema = z.object({
  period: z.enum(PERIOD_PRESETS).default("month"),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  status: z.string().optional(),
  categoryId: z.string().optional(),
  paymentMethod: z.string().optional(),
  supplier: z.string().trim().max(160).optional(),
  isRecurring: z.string().optional(),
  search: z.string().trim().max(160).optional(),
  sort: z
    .enum(["dueDate", "amount", "description", "supplier", "competenceDate"])
    .default("dueDate"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListDespesasInput = z.infer<typeof listDespesasSchema>

// ---------------------------------------------------------------------------
// Convênio
// ---------------------------------------------------------------------------

export const insurancePlanSchema = z.object({
  name: z.string().trim().min(2, "Nome é obrigatório").max(120),
  kind: z.enum(INSURANCE_PLAN_KINDS),
  coveragePercent: z
    .number()
    .finite()
    .min(0, "Percentual não pode ser negativo")
    .max(100, "Percentual não pode passar de 100")
    .optional()
    .nullable(),
  ansCode: z.string().trim().max(40).optional().nullable(),
})

export type InsurancePlanPayload = z.infer<typeof insurancePlanSchema>

// ---------------------------------------------------------------------------
// Sincronização das movimentações
// ---------------------------------------------------------------------------

export const syncIncomeSchema = z.object({
  actorName,
})

// ===========================================================================
// FINANCEIRO 2 — RECEITAS
// ===========================================================================
//
// Validação da LISTAGEM e do REGISTRO de recebimento.
//
// O cliente NUNCA informa o paciente: apenas `appointmentId`. O servidor
// resolve paciente, procedimentos e valor previsto a partir do atendimento.

/** Formas de pagamento aceitas (mesmo vocabulário de `payments`). */
export const RECEITA_PAYMENT_METHODS = [
  "pix",
  "dinheiro",
  "cartao_debito",
  "cartao_credito",
  "transferencia",
  "boleto",
  "outros",
] as const

/**
 * Status aceitos no FILTRO da listagem.
 *
 * - `settled`   -> recebido integralmente (dinheiro efetivado)
 * - `partial`   -> recebido parcialmente (saldo em aberto)
 * - `pending`   -> previsto, nada recebido ainda
 * - `cancelled` -> cancelado
 * - `reversed`  -> estornado
 */
export const RECEITA_STATUS_FILTERS = [
  "settled",
  "partial",
  "pending",
  "cancelled",
  "reversed",
] as const

export type ReceitaStatusFilter = (typeof RECEITA_STATUS_FILTERS)[number]

/**
 * Origens aceitas no filtro. A origem é DERIVADA no servidor — ela nunca é
 * gravada como texto livre pelo cliente.
 */
export const RECEITA_ORIGINS = ["appointment", "schedule", "manual"] as const
export type ReceitaOrigin = (typeof RECEITA_ORIGINS)[number]

/** Campos de ordenação aceitos (todos server-side). */
export const RECEITA_SORT_FIELDS = ["date", "amount", "patient"] as const
export type ReceitaSortField = (typeof RECEITA_SORT_FIELDS)[number]

export const RECEITA_SORT_DIRECTIONS = ["asc", "desc"] as const
export type ReceitaSortDirection = (typeof RECEITA_SORT_DIRECTIONS)[number]

const receitaSortField = z.enum(RECEITA_SORT_FIELDS)
const receitaSortDirection = z.enum(RECEITA_SORT_DIRECTIONS)

const receitaStatus = z.enum(RECEITA_STATUS_FILTERS)
const receitaOrigin = z.enum(RECEITA_ORIGINS)
const receitaMethod = z.enum(RECEITA_PAYMENT_METHODS)

/** Período da listagem: aceita os presets canônicos + datas do modo custom. */
export const receitaPeriodSchema = z.object({
  period: z.enum(PERIOD_PRESETS).default("month"),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD")
    .optional(),
})

export type ReceitaPeriodInput = z.infer<typeof receitaPeriodSchema>

const receitaPageSize = z
  .number()
  .int("Tamanho da página deve ser inteiro")
  .min(1, "Tamanho da página mínimo é 1")
  .max(100, "Tamanho da página máximo é 100")

/**
 * Filtros da listagem de receitas.
 *
 * Busca textual é feita no SERVIDOR (`search`) — nunca baixando a base inteira
 * para filtrar no cliente.
 */
export const listReceitasSchema = z.object({
  period: z.enum(PERIOD_PRESETS).default("month"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: receitaStatus.optional(),
  paymentMethod: receitaMethod.optional(),
  origin: receitaOrigin.optional(),
  professionalName: z.string().trim().max(160).optional(),
  search: z.string().trim().max(160).optional(),
  sort: receitaSortField.default("date"),
  direction: receitaSortDirection.default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: receitaPageSize.default(20),
})

export type ListReceitasInput = z.infer<typeof listReceitasSchema>

/** Detalhe de uma receita, por identificador. */
export const receitaDetailSchema = z.object({
  id: z.string().trim().min(1, "Identificador é obrigatório"),
})

/**
 * Registro de recebimento (pagamento total ou parcial) contra um atendimento.
 *
 * IMPORTANTE: `patientId` NÃO é aceito. O paciente é derivado do atendimento
 * no servidor — aceitá-lo do cliente permitiria criar relacionamento
 * financeiro inconsistente.
 */
export const registerReceitaSchema = z.object({
  appointmentId: z.string().trim().min(1, "Atendimento é obrigatório"),
  amount: money,
  paymentMethod: receitaMethod,
  actorName,
})

export type RegisterReceitaInput = z.infer<typeof registerReceitaSchema>

/** Estorno de uma receita (preserva o registro; nunca apaga). */
export const reverseReceitaSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
  actorName,
})

export type ReverseReceitaInput = z.infer<typeof reverseReceitaSchema>

// ===========================================================================
// FINANCEIRO 5 — FLUXO DE CAIXA
// ===========================================================================
//
// Validação da LISTAGEM do fluxo de caixa. Todos os filtros são server-side.
// O fluxo é DERIVADO (pagamentos de paciente + pagamentos de despesa): não há
// payload de escrita neste módulo.

/** Tipo de movimentação exibido (Todos / Entradas / Saídas). */
export const CASH_FLOW_TYPE_FILTERS = ["ALL", "INCOME", "EXPENSE"] as const
export type CashFlowTypeFilter = (typeof CASH_FLOW_TYPE_FILTERS)[number]

/** Origens aceitas no filtro (fontes de verdade do caixa). */
export const CASH_FLOW_SOURCE_FILTERS = ["PAYMENT", "EXPENSE_PAYMENT"] as const
export type CashFlowSourceFilter = (typeof CASH_FLOW_SOURCE_FILTERS)[number]

/** Campos de ordenação aceitos. */
export const CASH_FLOW_SORT_FIELDS = ["date", "amount"] as const
export type CashFlowSortField = (typeof CASH_FLOW_SORT_FIELDS)[number]

export const listCashFlowSchema = z.object({
  period: z.enum(PERIOD_PRESETS).default("month"),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  type: z.enum(CASH_FLOW_TYPE_FILTERS).default("ALL"),
  paymentMethod: z.string().trim().max(40).optional(),
  categoryId: z.string().trim().max(60).optional(),
  source: z.enum(CASH_FLOW_SOURCE_FILTERS).optional(),
  patientId: z.string().trim().max(60).optional(),
  supplier: z.string().trim().max(160).optional(),
  professionalName: z.string().trim().max(160).optional(),
  search: z.string().trim().max(160).optional(),
  sort: z.enum(CASH_FLOW_SORT_FIELDS).default("date"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListCashFlowInput = z.infer<typeof listCashFlowSchema>

/** Detalhe de uma movimentação do fluxo, por identificador composto. */
export const cashFlowDetailSchema = z.object({
  id: z.string().trim().min(1, "Identificador é obrigatório"),
})

export type CashFlowDetailInput = z.infer<typeof cashFlowDetailSchema>

// ===========================================================================
// FINANCEIRO 6 — RELATÓRIOS E FECHAMENTO
// ===========================================================================
//
// Periodização e filtros dos relatórios (todos server-side) e os payloads de
// fechamento/reabertura. O fechamento NÃO aceita valores: ele apenas recebe o
// período, uma observação opcional e o ator (atribuição textual). Os números
// vêm do servidor, nunca do cliente.

/** Filtro de período compartilhado pelos relatórios. */
export const reportPeriodSchema = z.object({
  period: z.enum(PERIOD_PRESETS).default("month"),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
})

export type ReportPeriodInput = z.infer<typeof reportPeriodSchema>

const reportPage = z.coerce.number().int().min(1).default(1)
const reportPageSize = z.coerce.number().int().min(1).max(100).default(20)

/** Relatório de receitas (filtros do Financeiro 2). */
export const reportReceitasSchema = reportPeriodSchema.extend({
  status: z.string().trim().max(40).optional(),
  paymentMethod: z.string().trim().max(40).optional(),
  professionalName: z.string().trim().max(160).optional(),
  search: z.string().trim().max(160).optional(),
  page: reportPage,
  pageSize: reportPageSize,
})

export type ReportReceitasInput = z.infer<typeof reportReceitasSchema>

/** Relatório de despesas (filtros do Financeiro 4). */
export const reportDespesasSchema = reportPeriodSchema.extend({
  status: z.string().trim().max(40).optional(),
  categoryId: z.string().trim().max(60).optional(),
  paymentMethod: z.string().trim().max(40).optional(),
  supplier: z.string().trim().max(160).optional(),
  search: z.string().trim().max(160).optional(),
  sort: z
    .enum(["dueDate", "amount", "description", "supplier", "competenceDate"])
    .default("dueDate"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  page: reportPage,
  pageSize: reportPageSize,
})

export type ReportDespesasInput = z.infer<typeof reportDespesasSchema>

/** Relatório de fluxo de caixa (mesmos filtros do Financeiro 5). */
export const reportCashFlowSchema = reportPeriodSchema.extend({
  type: z.enum(["ALL", "INCOME", "EXPENSE"]).default("ALL"),
  paymentMethod: z.string().trim().max(40).optional(),
  source: z.string().trim().max(40).optional(),
  search: z.string().trim().max(160).optional(),
  page: reportPage,
  pageSize: reportPageSize,
})

export type ReportCashFlowInput = z.infer<typeof reportCashFlowSchema>

/** Relatório de contas a receber (filtros do Financeiro 3). */
export const reportContasReceberSchema = reportPeriodSchema.extend({
  status: z.string().trim().max(40).optional(),
  search: z.string().trim().max(160).optional(),
  patientName: z.string().trim().max(160).optional(),
  procedureName: z.string().trim().max(160).optional(),
  professionalName: z.string().trim().max(160).optional(),
  sort: z.enum(["dueDate", "balance", "patient", "expected"]).default("dueDate"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  page: reportPage,
  pageSize: reportPageSize,
})

export type ReportContasReceberInput = z.infer<typeof reportContasReceberSchema>

/** Relatório por forma de pagamento. */
export const reportPaymentMethodsSchema = reportPeriodSchema.extend({
  professionalName: z.string().trim().max(160).optional(),
  search: z.string().trim().max(160).optional(),
})

export type ReportPaymentMethodsInput = z.infer<typeof reportPaymentMethodsSchema>

// --- Fechamento ------------------------------------------------------------

/** Validação pré-fechamento (não fecha: só avalia o período). */
export const validateClosingSchema = z.object({
  from: dateOnly,
  to: dateOnly,
})

export type ValidateClosingInput = z.infer<typeof validateClosingSchema>

/** Fechamento do período. */
export const closePeriodSchema = z.object({
  from: dateOnly,
  to: dateOnly,
  notes: z.string().trim().max(2000).optional().nullable(),
  actorName,
})

export type ClosePeriodInput = z.infer<typeof closePeriodSchema>

/** Reabertura — o MOTIVO é obrigatório. */
export const reopenClosingSchema = z.object({
  reason: z.string().trim().min(3, "Informe o motivo da reabertura").max(500),
  actorName,
})

export type ReopenClosingInput = z.infer<typeof reopenClosingSchema>

/** Histórico de fechamentos (paginação + status). */
export const listClosingsSchema = z.object({
  status: z.enum(["closed", "reopened"]).optional(),
  page: reportPage,
  pageSize: reportPageSize,
})

export type ListClosingsInput = z.infer<typeof listClosingsSchema>

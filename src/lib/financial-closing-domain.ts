// ===========================================================================
// DOMÍNIO DO FECHAMENTO FINANCEIRO — módulo Financeiro (Financeiro 6).
// ===========================================================================
//
// Fonte da verdade das REGRAS DE FECHAMENTO. Arquivo PURO (não acessa banco),
// portanto testável isoladamente — mesma convenção de `financial-domain.ts`.
//
// O QUE É O FECHAMENTO
//
// O fechamento é a CONFIRMAÇÃO de que um período financeiro foi revisado e
// encerrado. Ele NÃO é uma nova fonte de verdade financeira: os números
// continuam nascendo em `payments` (receita) e `expense_payments` (saída).
// O fechamento apenas:
//
//   1. valida se o período pode ser fechado (pendências, sobreposição);
//   2. congela um SNAPSHOT dos totais existentes no momento do fechamento;
//   3. registra quem fechou, quando, e (na reabertura) por quê.
//
// DIFERENÇA ENTRE RESULTADO FINANCEIRO E LUCRO CONTÁBIL
//
// O sistema NÃO possui contabilidade completa (não há competência contábil,
// depreciação, provisão, impostos sobre lucro, EBITDA). Por isso o indicador
// de resultado é sempre chamado de:
//
//   "Resultado financeiro do período" (= receitas recebidas - despesas pagas)
//
// NUNCA "lucro", "lucro líquido", "EBITDA" ou "resultado contábil".

// ---------------------------------------------------------------------------
// Status do fechamento
// ---------------------------------------------------------------------------

export const CLOSING_STATUSES = ["closed", "reopened"] as const
export type ClosingStatus = (typeof CLOSING_STATUSES)[number]

export const CLOSING_STATUS_LABELS: Record<ClosingStatus, string> = {
  closed: "Fechado",
  reopened: "Reaberto",
}

export const CLOSING_STATUS_COLORS: Record<ClosingStatus, string> = {
  closed: "bg-green-100 text-green-800",
  reopened: "bg-amber-100 text-amber-800",
}

export function closingStatusLabel(status: string): string {
  return CLOSING_STATUS_LABELS[status as ClosingStatus] ?? status
}

// ---------------------------------------------------------------------------
// Eventos de auditoria do fechamento
// ---------------------------------------------------------------------------

export const CLOSING_EVENTS = ["closed", "reopened"] as const
export type ClosingEvent = (typeof CLOSING_EVENTS)[number]

export const CLOSING_EVENT_LABELS: Record<ClosingEvent, string> = {
  closed: "Período fechado",
  reopened: "Período reaberto",
}

export function closingEventLabel(event: string): string {
  return CLOSING_EVENT_LABELS[event as ClosingEvent] ?? event
}

// ---------------------------------------------------------------------------
// Rótulo canônico do resultado
// ---------------------------------------------------------------------------
// Usado em toda a UI/relatórios para NÃO sugerir contabilidade completa.

export const FINANCIAL_RESULT_LABEL = "Resultado financeiro do período"

export const FINANCIAL_RESULT_DESCRIPTION =
  "Receitas recebidas menos despesas pagas no período. Não é lucro contábil."

// ---------------------------------------------------------------------------
// Sobreposição de períodos
// ---------------------------------------------------------------------------
// Dois períodos se sobrepõem quando compartilham QUALQUER instante. Intervalos
// são INCLUSIVOS nas pontas (start e end pertencem ao período), então o
// critério de sobreposição é: aStart <= bEnd && bStart <= aEnd.

export function periodsOverlap(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date }
): boolean {
  return a.start.getTime() <= b.end.getTime() && b.start.getTime() <= a.end.getTime()
}

/** Um fechamento é considerado ATIVO enquanto não foi reaberto. */
export function isActiveClosing(status: string): boolean {
  return status === "closed"
}

// ---------------------------------------------------------------------------
// Snapshot do fechamento
// ---------------------------------------------------------------------------
// O snapshot é o retrato dos números NO MOMENTO do fechamento. Ele nunca é
// recalculado depois: serve justamente para comparar com o que os relatórios
// mostram hoje e detectar alterações retroativas.

export interface ClosingSnapshot {
  /** Total de receitas efetivamente RECEBIDAS no período. */
  income: number
  /** Total de despesas efetivamente PAGAS no período. */
  expense: number
  /** Saldo do período = income - expense. */
  periodBalance: number
  /** Saldo acumulado ANTES do período (histórico conhecido). */
  openingBalance: number
  /** Saldo acumulado AO FINAL do período. */
  closingBalance: number
  /** Contas a receber em aberto (PREVISÃO — não é receita). */
  receivable: number
  /** Despesas a pagar em aberto (compromisso — não é saída de caixa). */
  payable: number
  /** Resultado financeiro do período = income - expense. */
  result: number
  /** Quantidade de movimentações de entrada. */
  incomeCount: number
  /** Quantidade de movimentações de saída. */
  expenseCount: number
}

/** Lê o snapshot armazenado numa linha de fechamento. */
export function snapshotFromRow(row: {
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
}): ClosingSnapshot {
  return {
    income: row.snapshotIncome,
    expense: row.snapshotExpense,
    periodBalance: row.snapshotPeriodBalance,
    openingBalance: row.snapshotOpeningBalance,
    closingBalance: row.snapshotClosingBalance,
    receivable: row.snapshotReceivable,
    payable: row.snapshotPayable,
    result: row.snapshotResult,
    incomeCount: row.snapshotIncomeCount,
    expenseCount: row.snapshotExpenseCount,
  }
}

export interface SnapshotComparisonLine {
  field: keyof ClosingSnapshot
  label: string
  /** Valor congelado no fechamento. */
  snapshotValue: number
  /** Valor atual (recalculado das fontes de verdade). */
  currentValue: number
  /** currentValue - snapshotValue. */
  difference: number
  /** true quando há divergência significativa (fora da tolerância). */
  changed: boolean
}

export interface SnapshotComparison {
  hasChanges: boolean
  lines: SnapshotComparisonLine[]
}

const COMPARISON_LABELS: Partial<Record<keyof ClosingSnapshot, string>> = {
  income: "Receitas recebidas",
  expense: "Despesas pagas",
  periodBalance: "Saldo do período",
  openingBalance: "Saldo acumulado anterior",
  closingBalance: "Saldo acumulado final",
  receivable: "Contas a receber",
  payable: "Despesas a pagar",
  result: "Resultado financeiro",
  incomeCount: "Nº de entradas",
  expenseCount: "Nº de saídas",
}

/**
 * Compara o snapshot congelado com os valores ATUAIS.
 *
 * Divergência só é sinalizada quando o valor difere de forma significativa —
 * a tolerância padrão (1 centavo) evita falso positivo por arredondamento de
 * ponto flutuante. Não escondemos mudança real: só ignoramos ruído numérico.
 */
export function compareSnapshot(
  snapshot: ClosingSnapshot,
  current: ClosingSnapshot,
  tolerance = 0.01
): SnapshotComparison {
  const fields = Object.keys(COMPARISON_LABELS) as (keyof ClosingSnapshot)[]
  const lines: SnapshotComparisonLine[] = fields.map((field) => {
    const snapshotValue = snapshot[field]
    const currentValue = current[field]
    const difference = Math.round((currentValue - snapshotValue) * 100) / 100
    return {
      field,
      label: COMPARISON_LABELS[field] ?? field,
      snapshotValue,
      currentValue,
      difference,
      changed:
        field === "incomeCount" || field === "expenseCount"
          ? currentValue !== snapshotValue
          : Math.abs(difference) > tolerance,
    }
  })

  return {
    hasChanges: lines.some((l) => l.changed),
    lines,
  }
}

// ---------------------------------------------------------------------------
// Validação pré-fechamento (regras puras)
// ---------------------------------------------------------------------------
// As verificações que dependem do banco (sobreposição com fechamento
// existente) são resolvidas no serviço; aqui ficam as regras puramente
// derivadas do PERÍODO e dos dados agregados.

export type ClosingValidationSeverity = "error" | "warning" | "info"

export interface ClosingValidationCheck {
  code: string
  severity: ClosingValidationSeverity
  title: string
  description: string
  /** Quando true, o fechamento é BLOQUEADO. */
  blocking: boolean
}

export interface ClosingValidationInput {
  start: Date
  end: Date
  /** Fechamentos ativos que se sobrepõem ao período (resolvido no serviço). */
  overlappingActiveClosings: number
  /** Pendências que podem indicar período ainda em movimento. */
  openReceivableCount: number
  openPayableCount: number
  /** Movimentações efetivadas no período (se 0, avisamos). */
  movementCount: number
  /** Data de referência (para checar período futuro). */
  reference?: Date
}

/**
 * Avalia se o período pode ser fechado.
 *
 * REGRAS BLOQUEANTES (impedem o fechamento):
 *   - período invertido ou degenerado;
 *   - período totalmente no FUTURO (não há o que fechar);
 *   - sobreposição com um fechamento ATIVO.
 *
 * REGRAS DE AVISO (não impedem, mas exigem ciência):
 *   - contas a receber / despesas a pagar em aberto (o fechamento fecha o
 *     CAIXA do período; o saldo em aberto continua sendo tratado nos módulos
 *     de Contas a Receber / Despesas);
 *   - período sem nenhuma movimentação efetivada.
 */
export function validateClosingPeriod(
  input: ClosingValidationInput
): ClosingValidationCheck[] {
  const reference = input.reference ?? new Date()
  const checks: ClosingValidationCheck[] = []

  // 1) Período válido.
  if (input.end.getTime() < input.start.getTime()) {
    checks.push({
      code: "PERIOD_INVALID",
      severity: "error",
      title: "Período inválido",
      description: "A data inicial é posterior à data final.",
      blocking: true,
    })
  }

  // 2) Período futuro.
  if (input.start.getTime() > reference.getTime()) {
    checks.push({
      code: "PERIOD_IN_FUTURE",
      severity: "error",
      title: "Período no futuro",
      description: "Não é possível fechar um período que ainda não começou.",
      blocking: true,
    })
  }

  // 3) Sobreposição com fechamento ativo.
  if (input.overlappingActiveClosings > 0) {
    checks.push({
      code: "PERIOD_OVERLAP",
      severity: "error",
      title: "Período já possui fechamento ativo",
      description:
        "Existe um fechamento ativo que se sobrepõe a este período. Reabra-o antes de fechar novamente.",
      blocking: true,
    })
  }

  // 4) Pendências (informativo — o fechamento é do CAIXA do período).
  if (input.openReceivableCount > 0) {
    checks.push({
      code: "OPEN_RECEIVABLE",
      severity: "warning",
      title: "Contas a receber em aberto",
      description: `${input.openReceivableCount} conta(s) a receber ainda em aberto. O fechamento consolida o caixa do período; pendências continuam sendo acompanhadas em Contas a Receber.`,
      blocking: false,
    })
  }

  if (input.openPayableCount > 0) {
    checks.push({
      code: "OPEN_PAYABLE",
      severity: "warning",
      title: "Despesas a pagar em aberto",
      description: `${input.openPayableCount} despesa(s) ainda não paga(s). Apenas o que foi PAGO entra no caixa do período.`,
      blocking: false,
    })
  }

  // 5) Período sem movimentação.
  if (input.movementCount === 0) {
    checks.push({
      code: "NO_MOVEMENTS",
      severity: "info",
      title: "Período sem movimentações",
      description:
        "Não há entradas ou saídas efetivadas neste período. O fechamento registrará totais zerados.",
      blocking: false,
    })
  }

  return checks
}

export function hasBlockingChecks(checks: readonly ClosingValidationCheck[]): boolean {
  return checks.some((c) => c.blocking)
}

// ---------------------------------------------------------------------------
// Datas do período de fechamento
// ---------------------------------------------------------------------------

/** Formata "YYYY-MM" de um mês (1-12). */
export function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`
}

/** Rótulo "MM/YYYY" a partir de "YYYY-MM". */
export function monthKeyToLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  return m ? `${m[2]}/${m[1]}` : key
}

/** Lista de meses (YYYY-MM) entre dois instantes, inclusivo. */
export function monthsBetween(start: Date, end: Date): string[] {
  const months: string[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cursor.getTime() <= last.getTime() && months.length < 240) {
    months.push(monthKey(cursor.getFullYear(), cursor.getMonth()))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return months
}

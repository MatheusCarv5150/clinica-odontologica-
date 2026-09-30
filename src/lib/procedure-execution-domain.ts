// ===========================================================================
// Domínio dos PROCEDIMENTOS DO ATENDIMENTO — módulo Atendimento (Parte 7).
// ===========================================================================
//
// Fonte da verdade dos ESTADOS da execução de procedimento e das REGRAS que
// comparam o que estava PREVISTO (Agenda) com o que foi REALIZADO.
//
// Backend e frontend leem daqui. Nenhum rótulo/estado é decidido "na tela":
// a apresentação deriva destes metadados.
//
// PRINCÍPIOS OBRIGATÓRIOS (regra de ouro da Parte 7):
//   AGENDA          = intenção / agendamento (o previsto)
//   PROCEDIMENTOS   = execução (o realizado)
//   ODONTOGRAMA     = situação odontológica
//   EVOLUÇÃO        = relato clínico
//   HISTÓRICO       = trajetória
//   PLANO/FINANCEIRO = futuro
// Essas responsabilidades NÃO se misturam. Este módulo cuida APENAS da
// execução: não emite diagnóstico, não altera a Agenda e não cria pagamentos.

import { normalizeSurfaces, parseSurfaces } from "@/lib/tooth-catalog"

// ---------------------------------------------------------------------------
// Origem do registro
// ---------------------------------------------------------------------------

// "scheduled": veio da Agenda (procedimento que foi marcado).
// "added_in_attendance": identificado e adicionado durante o atendimento.
export type ProcedureOrigin = "scheduled" | "added_in_attendance"

export const PROCEDURE_ORIGINS: ProcedureOrigin[] = [
  "scheduled",
  "added_in_attendance",
]

export const PROCEDURE_ORIGIN_LABELS: Record<ProcedureOrigin, string> = {
  scheduled: "Agenda",
  added_in_attendance: "Adicionado no atendimento",
}

export function isProcedureOrigin(value: unknown): value is ProcedureOrigin {
  return value === "scheduled" || value === "added_in_attendance"
}

// ---------------------------------------------------------------------------
// Status da execução
// ---------------------------------------------------------------------------

// Estados do procedimento NO ATENDIMENTO. São deliberadamente enxutos e
// padronizados com o restante do sistema (a evolução já usa performed /
// planned / cancelled). Estendemos com os estados que a Parte 7 exige:
//
//   pending       -> veio da Agenda, aguardando realização
//   in_progress   -> em execução
//   performed     -> realizado (alimenta execução/histórico/financeiro futuro)
//   not_performed -> estava previsto, não foi executado (com motivo)
//   cancelled     -> cancelamento controlado (registro preservado)
export type ProcedureExecutionStatus =
  | "pending"
  | "in_progress"
  | "performed"
  | "not_performed"
  | "cancelled"

export const PROCEDURE_EXECUTION_STATUSES: ProcedureExecutionStatus[] = [
  "pending",
  "in_progress",
  "performed",
  "not_performed",
  "cancelled",
]

export const PROCEDURE_STATUS_META: Record<
  ProcedureExecutionStatus,
  {
    label: string
    shortLabel: string
    description: string
    // Classe visual padronizada (mesma linguagem do restante do prontuário).
    className: string
    dot: string
  }
> = {
  pending: {
    label: "Aguardando realização",
    shortLabel: "Aguardando",
    description: "Procedimento previsto na Agenda que ainda não foi executado.",
    className: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  in_progress: {
    label: "Em execução",
    shortLabel: "Em execução",
    description: "Procedimento iniciado e ainda não concluído.",
    className: "border-blue-200 bg-blue-50 text-blue-800",
    dot: "bg-blue-500",
  },
  performed: {
    label: "Realizado",
    shortLabel: "Realizado",
    description: "Procedimento efetivamente executado neste atendimento.",
    className: "border-green-200 bg-green-50 text-green-800",
    dot: "bg-green-500",
  },
  not_performed: {
    label: "Não realizado",
    shortLabel: "Não realizado",
    description: "Procedimento previsto que não foi executado neste atendimento.",
    className: "border-gray-300 bg-gray-100 text-gray-700",
    dot: "bg-gray-400",
  },
  cancelled: {
    label: "Cancelado",
    shortLabel: "Cancelado",
    description: "Procedimento cancelado com registro preservado para auditoria.",
    className: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500",
  },
}

export function isProcedureExecutionStatus(
  value: unknown
): value is ProcedureExecutionStatus {
  return (
    value === "pending" ||
    value === "in_progress" ||
    value === "performed" ||
    value === "not_performed" ||
    value === "cancelled"
  )
}

export function getProcedureStatusMeta(status: string) {
  return isProcedureExecutionStatus(status)
    ? PROCEDURE_STATUS_META[status]
    : PROCEDURE_STATUS_META.pending
}

// Status que contam como EXECUÇÃO efetiva (alimentam valor realizado e,
// futuramente, o Financeiro).
export const PERFORMED_STATUSES: ProcedureExecutionStatus[] = ["performed"]

export function isPerformed(status: string): boolean {
  return status === "performed"
}

// Status "terminais": não são mais alterados por transições comuns.
export const TERMINAL_STATUSES: ProcedureExecutionStatus[] = [
  "performed",
  "not_performed",
  "cancelled",
]

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as ProcedureExecutionStatus)
}

// ---------------------------------------------------------------------------
// Motivos de não realização
// ---------------------------------------------------------------------------

// Códigos CONTROLADOS (não é texto livre): permitem relatórios futuros e
// evitam inconsistências. `note` complementa com a observação do profissional.
export type ProcedureReasonCode =
  | "patient_not_authorized"
  | "postponed"
  | "needs_further_evaluation"
  | "patient_unfit"
  | "patient_absent"
  | "other"

export const PROCEDURE_REASONS: Array<{
  code: ProcedureReasonCode
  label: string
}> = [
  { code: "patient_not_authorized", label: "Paciente não autorizou" },
  { code: "postponed", label: "Procedimento adiado" },
  { code: "needs_further_evaluation", label: "Necessidade de avaliação adicional" },
  { code: "patient_unfit", label: "Paciente não apresentou condições" },
  { code: "patient_absent", label: "Paciente não compareceu" },
  { code: "other", label: "Outro" },
]

const REASON_LABELS = new Map(PROCEDURE_REASONS.map((r) => [r.code, r.label]))

export function isProcedureReasonCode(value: unknown): value is ProcedureReasonCode {
  return typeof value === "string" && REASON_LABELS.has(value as ProcedureReasonCode)
}

export function getProcedureReasonLabel(code: string | null): string | null {
  if (!code) return null
  return REASON_LABELS.get(code as ProcedureReasonCode) ?? null
}

// ---------------------------------------------------------------------------
// Regra de alteração de valor
// ---------------------------------------------------------------------------

// Espelha a regra JÁ EXISTENTE no módulo Procedimentos
// (`Procedure.allowPriceOverride`). O backend valida; o frontend apenas
// antecipa o feedback.
export function canOverridePrice(allowPriceOverride: boolean): boolean {
  return allowPriceOverride === true
}

// ---------------------------------------------------------------------------
// Comparação PREVISTO × REALIZADO
// ---------------------------------------------------------------------------

// Resultado da comparação entre o item da Agenda e a execução registrada.
export type ProcedureComparisonResult =
  | "performed_as_planned" // previsto e realizado
  | "not_performed" // previsto e NÃO realizado
  | "added_in_attendance" // não previsto e realizado (adicionado no atendimento)
  | "pending" // previsto e ainda aguardando
  | "cancelled" // cancelado

export const PROCEDURE_COMPARISON_META: Record<
  ProcedureComparisonResult,
  { label: string; description: string; className: string }
> = {
  performed_as_planned: {
    label: "Realizado conforme previsto",
    description: "O procedimento estava previsto e foi executado.",
    className: "border-green-200 bg-green-50 text-green-800",
  },
  not_performed: {
    label: "Não realizado",
    description: "O procedimento estava previsto e não foi executado.",
    className: "border-gray-300 bg-gray-100 text-gray-700",
  },
  added_in_attendance: {
    label: "Adicionado durante o atendimento",
    description:
      "O procedimento não estava previsto na Agenda e foi registrado durante o atendimento.",
    className: "border-blue-200 bg-blue-50 text-blue-800",
  },
  pending: {
    label: "Aguardando realização",
    description: "O procedimento estava previsto e ainda não foi executado.",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  cancelled: {
    label: "Cancelado",
    description: "O procedimento foi cancelado com registro preservado.",
    className: "border-red-200 bg-red-50 text-red-800",
  },
}

export interface ComparisonInput {
  origin: ProcedureOrigin
  status: ProcedureExecutionStatus
  // Quando verdadeiro, o item está ligado a um item da Agenda.
  isScheduled: boolean
}

// Deriva o resultado da comparação. Regra central da Parte 7:
// - previsto + realizado  -> "Realizado conforme previsto"
// - previsto + não feito  -> "Não realizado"
// - não previsto + feito  -> "Adicionado durante o atendimento"
export function compareScheduledVsPerformed(
  input: ComparisonInput
): ProcedureComparisonResult {
  if (input.status === "cancelled") return "cancelled"
  if (input.status === "not_performed") return "not_performed"

  if (input.isScheduled && input.origin === "scheduled") {
    return input.status === "performed" ? "performed_as_planned" : "pending"
  }

  // Não previsto na Agenda.
  return input.status === "performed" ? "added_in_attendance" : "pending"
}

// ---------------------------------------------------------------------------
// Valores (diferença explícita, nunca sobrescrita)
// ---------------------------------------------------------------------------

export interface ValueComparison {
  expectedPrice: number | null
  performedPrice: number | null
  // Diferença (realizado - previsto). Positiva = cobrado mais que o previsto.
  difference: number | null
  // Diferença acima de um centavo (evita ruído de ponto flutuante).
  isDifferent: boolean
}

export function compareValues(
  expectedPrice: number | null | undefined,
  performedPrice: number | null | undefined
): ValueComparison {
  const expected = typeof expectedPrice === "number" ? expectedPrice : null
  const performed = typeof performedPrice === "number" ? performedPrice : null
  let difference: number | null = null
  if (expected !== null && performed !== null) {
    difference = Math.round((performed - expected) * 100) / 100
  }
  return {
    expectedPrice: expected,
    performedPrice: performed,
    difference,
    isDifferent:
      difference !== null && Math.abs(difference) >= 0.01,
  }
}

// ---------------------------------------------------------------------------
// Normalização de dente/superfície
// ---------------------------------------------------------------------------

// Normaliza as superfícies para CSV estável (M,D,O,V,L) — mesma convenção do
// odontograma, garantindo que a comparação textual nunca divirja.
export function normalizeProcedureSurfaces(input: readonly string[]): string {
  return normalizeSurfaces(input)
}

export function procedureSurfacesToList(csv: string | null | undefined): string[] {
  return parseSurfaces(csv)
}

// ---------------------------------------------------------------------------
// Detectores de duplicidade
// ---------------------------------------------------------------------------

export interface DedupCandidate {
  procedureId: string
  toothNumber: string | null
  surfaces: string
  status: string
}

// Chave lógica de um procedimento dentro do atendimento: catálogo + dente +
// superfícies. Usada para AVISAR sobre possível duplicidade. NÃO bloqueia o
// profissional de registrar dois procedimentos legítimos no mesmo dente.
export function buildProcedureKey(candidate: {
  procedureId: string
  toothNumber?: string | null
  surfaces?: string
}): string {
  const tooth = candidate.toothNumber ?? "none"
  const surfaces = candidate.surfaces ? normalizeSurfaces(candidate.surfaces.split(",")) : ""
  return `${candidate.procedureId}|${tooth}|${surfaces || "none"}`
}

// Detecta se já existe um procedimento REALIZADO equivalente no atendimento.
// Retorna o candidato duplicado (ou null). O serviço decide o que fazer:
// aqui não há efeito colateral nem escrita.
export function findDuplicate(
  existing: DedupCandidate[],
  incoming: { procedureId: string; toothNumber: string | null; surfaces: string }
): DedupCandidate | null {
  const incomingKey = buildProcedureKey(incoming)
  for (const item of existing) {
    if (item.status !== "performed" && item.status !== "in_progress") continue
    if (buildProcedureKey(item) === incomingKey) return item
  }
  return null
}

// ---------------------------------------------------------------------------
// Apresentação
// ---------------------------------------------------------------------------

// Resumo textual do dente/superfície (ex.: "26 • Oclusal").
export function formatToothReference(
  toothNumber: string | null,
  surfaces: string[]
): string | null {
  if (!toothNumber) return null
  if (!surfaces || surfaces.length === 0) return `Dente ${toothNumber}`
  return `Dente ${toothNumber} • ${surfaces.join(", ")}`
}

import {
  parseSurfaces,
  normalizeSurfaces,
  getSurfaceLabel,
  getToothDefinition,
  type Dentition,
  type ToothSurface,
} from "@/lib/tooth-catalog"

// ===========================================================================
// DOMÍNIO DO PLANO DE TRATAMENTO — Módulo Atendimento (Parte 10.1).
//
// Regras puras (sem Prisma, sem HTTP): podem ser testadas isoladamente e são a
// ÚNICA autoridade sobre a nomenclatura de status/prioridade. O serviço e a UI
// derivam daqui — nenhuma tela recria as listas.
//
// PRINCÍPIO CENTRAL: PLANEJADO ≠ REALIZADO.
// O item do plano descreve uma INTENÇÃO. Ele não altera o estado do dente nem
// cria execução de procedimento. A confirmação de realização é uma ação
// clínica explícita, feita na área de Procedimentos/atendimento.
// ===========================================================================

export type TreatmentPlanStatus = "draft" | "active" | "completed" | "cancelled"

export const TREATMENT_PLAN_STATUSES: TreatmentPlanStatus[] = [
  "draft",
  "active",
  "completed",
  "cancelled",
]

export const TREATMENT_PLAN_STATUS_META: Record<
  TreatmentPlanStatus,
  { label: string; description: string; className: string; dot: string }
> = {
  draft: {
    label: "Rascunho",
    description: "Plano em elaboração, ainda não em execução.",
    className: "border-gray-300 bg-gray-100 text-gray-700",
    dot: "bg-gray-400",
  },
  active: {
    label: "Em andamento",
    description: "Plano vigente, com itens planejados/em execução.",
    className: "border-blue-200 bg-blue-50 text-blue-800",
    dot: "bg-blue-500",
  },
  completed: {
    label: "Concluído",
    description: "Todos os itens do plano foram finalizados.",
    className: "border-green-200 bg-green-50 text-green-800",
    dot: "bg-green-500",
  },
  cancelled: {
    label: "Cancelado",
    description: "Plano suspenso/cancelado com registro preservado.",
    className: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500",
  },
}

export function isTreatmentPlanStatus(
  value: unknown
): value is TreatmentPlanStatus {
  return (
    typeof value === "string" &&
    (TREATMENT_PLAN_STATUSES as string[]).includes(value)
  )
}

export function getTreatmentPlanStatusMeta(status: string) {
  return (
    TREATMENT_PLAN_STATUS_META[status as TreatmentPlanStatus] ??
    TREATMENT_PLAN_STATUS_META.active
  )
}

// ---------------------------------------------------------------------------
// Status do item
// ---------------------------------------------------------------------------

// Ciclo de vida de um item do plano. A ordem abaixo é a sequência natural de
// progressão e é usada para agrupar/somar na UI.
export type TreatmentPlanItemStatus =
  | "planned"
  | "awaiting_start"
  | "in_progress"
  | "partially_done"
  | "completed"
  | "cancelled"
  | "not_done"

export const TREATMENT_PLAN_ITEM_STATUSES: TreatmentPlanItemStatus[] = [
  "planned",
  "awaiting_start",
  "in_progress",
  "partially_done",
  "completed",
  "cancelled",
  "not_done",
]

export const TREATMENT_PLAN_ITEM_STATUS_META: Record<
  TreatmentPlanItemStatus,
  {
    label: string
    shortLabel: string
    description: string
    className: string
    dot: string
  }
> = {
  planned: {
    label: "Planejado",
    shortLabel: "Planejado",
    description: "Item previsto no plano, ainda não iniciado.",
    className: "border-gray-300 bg-gray-100 text-gray-700",
    dot: "bg-gray-400",
  },
  awaiting_start: {
    label: "Aguardando início",
    shortLabel: "Aguardando",
    description: "Item priorizado e aguardando o início da execução.",
    className: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  in_progress: {
    label: "Em andamento",
    shortLabel: "Em andamento",
    description: "Execução iniciada e ainda não concluída.",
    className: "border-blue-200 bg-blue-50 text-blue-800",
    dot: "bg-blue-500",
  },
  partially_done: {
    label: "Parcialmente realizado",
    shortLabel: "Parcial",
    description: "Parte do item foi executada em um ou mais atendimentos.",
    className: "border-indigo-200 bg-indigo-50 text-indigo-800",
    dot: "bg-indigo-500",
  },
  completed: {
    label: "Concluído",
    shortLabel: "Concluído",
    description: "Item executado por completo.",
    className: "border-green-200 bg-green-50 text-green-800",
    dot: "bg-green-500",
  },
  cancelled: {
    label: "Cancelado",
    shortLabel: "Cancelado",
    description: "Item cancelado com registro preservado para auditoria.",
    className: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500",
  },
  not_done: {
    label: "Não realizado",
    shortLabel: "Não realizado",
    description: "Item que deixou de ser executado (com motivo registrado).",
    className: "border-orange-200 bg-orange-50 text-orange-800",
    dot: "bg-orange-500",
  },
}

export function isTreatmentPlanItemStatus(
  value: unknown
): value is TreatmentPlanItemStatus {
  return (
    typeof value === "string" &&
    (TREATMENT_PLAN_ITEM_STATUSES as string[]).includes(value)
  )
}

export function getTreatmentPlanItemStatusMeta(status: string) {
  return (
    TREATMENT_PLAN_ITEM_STATUS_META[status as TreatmentPlanItemStatus] ??
    TREATMENT_PLAN_ITEM_STATUS_META.planned
  )
}

// Estados que representam "fechamento" do item (não contam como pendente).
export const CLOSED_ITEM_STATUSES: TreatmentPlanItemStatus[] = [
  "completed",
  "cancelled",
  "not_done",
]

export function isClosedItemStatus(status: string): boolean {
  return (CLOSED_ITEM_STATUSES as string[]).includes(status)
}

// Estados que representam execução em curso (para o resumo visual).
export function isRunningItemStatus(status: string): boolean {
  return status === "in_progress" || status === "partially_done"
}

// ---------------------------------------------------------------------------
// Prioridade
// ---------------------------------------------------------------------------

export type TreatmentPlanPriority = "low" | "medium" | "high" | "urgent"

export const TREATMENT_PLAN_PRIORITIES: TreatmentPlanPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
]

export const TREATMENT_PLAN_PRIORITY_META: Record<
  TreatmentPlanPriority,
  { label: string; className: string; order: number }
> = {
  low: { label: "Baixa", className: "border-gray-300 bg-gray-50 text-gray-700", order: 4 },
  medium: {
    label: "Média",
    className: "border-blue-200 bg-blue-50 text-blue-800",
    order: 3,
  },
  high: {
    label: "Alta",
    className: "border-amber-200 bg-amber-50 text-amber-800",
    order: 2,
  },
  urgent: {
    label: "Urgente",
    className: "border-red-200 bg-red-50 text-red-800",
    order: 1,
  },
}

export function isTreatmentPlanPriority(
  value: unknown
): value is TreatmentPlanPriority {
  return (
    typeof value === "string" &&
    (TREATMENT_PLAN_PRIORITIES as string[]).includes(value)
  )
}

export function getTreatmentPlanPriorityMeta(priority: string) {
  return (
    TREATMENT_PLAN_PRIORITY_META[priority as TreatmentPlanPriority] ??
    TREATMENT_PLAN_PRIORITY_META.medium
  )
}

// ---------------------------------------------------------------------------
// Dente / superfície (MESMA convenção do odontograma)
// ---------------------------------------------------------------------------

// Normaliza as superfícies para o CSV canônico (M,D,O,V,L) reutilizando o
// catálogo de dentes — jamais criamos uma segunda convenção.
export function normalizePlanSurfaces(input: readonly string[]): string {
  return normalizeSurfaces(input)
}

export function planSurfacesToList(csv: string | null | undefined): string[] {
  return parseSurfaces(csv)
}

// Valida o dente e devolve a dentição derivada (permanente/decíduo).
// Retorna null quando o número FDI é inválido.
export function resolvePlanTooth(
  toothNumber: string | null | undefined,
  dentition?: string | null
): { toothNumber: string; dentition: Dentition } | null {
  if (!toothNumber) return null
  const tooth = getToothDefinition(toothNumber)
  if (!tooth) return null
  if (dentition && dentition !== tooth.dentition) return null
  return { toothNumber, dentition: tooth.dentition }
}

// Referência legível (ex.: "Dente 16 • Oclusal"). Mesma formatação usada pelos
// procedimentos do atendimento, para manter a linguagem consistente.
export function formatPlanToothReference(
  toothNumber: string | null,
  surfaces: string[]
): string | null {
  if (!toothNumber) return null
  if (!surfaces || surfaces.length === 0) return `Dente ${toothNumber}`
  // O rótulo da face oclusal varia com o tipo do dente (Incisal em anteriores),
  // exatamente como no odontograma — nenhuma segunda convenção é criada.
  const toothType = getToothDefinition(toothNumber)?.type ?? "first_molar"
  const labels = surfaces.map((s) =>
    getSurfaceLabel(s as ToothSurface, toothType)
  )
  return `Dente ${toothNumber} • ${labels.join(", ")}`
}

// ---------------------------------------------------------------------------
// Resumo do plano (derivado SEMPRE dos dados reais, nunca mockado)
// ---------------------------------------------------------------------------

export interface PlanSummaryInput {
  status: string
  expectedPrice: number | null
  quantity: number
}

export interface TreatmentPlanSummary {
  totalItems: number
  plannedCount: number
  awaitingCount: number
  inProgressCount: number
  partiallyDoneCount: number
  completedCount: number
  cancelledCount: number
  notDoneCount: number
  // Agregados usados no cabeçalho de resumo.
  openCount: number
  pendingCount: number
  // Valores previstos (planejamento — não representam valores realizados).
  estimatedTotal: number
  progressPercent: number
}

// Deriva o resumo a partir dos itens reais. O "valor realizado" NÃO é
// calculado aqui: ele pertence ao Financeiro/execução (Parte 7) e não deve ser
// inferido a partir do planejamento.
export function summarizePlan(items: PlanSummaryInput[]): TreatmentPlanSummary {
  const count = (status: string) =>
    items.filter((item) => item.status === status).length

  const completedCount = count("completed")
  const cancelledCount = count("cancelled")
  const notDoneCount = count("not_done")

  const estimatedTotal =
    Math.round(
      items
        .filter((item) => item.status !== "cancelled")
        .reduce(
          (sum, item) =>
            sum + (item.expectedPrice ?? 0) * Math.max(1, item.quantity),
          0
        ) * 100
    ) / 100

  const relevant = items.length - cancelledCount
  const progressPercent =
    relevant > 0 ? Math.round((completedCount / relevant) * 100) : 0

  return {
    totalItems: items.length,
    plannedCount: count("planned"),
    awaitingCount: count("awaiting_start"),
    inProgressCount: count("in_progress"),
    partiallyDoneCount: count("partially_done"),
    completedCount,
    cancelledCount,
    notDoneCount,
    openCount: items.filter((item) => !isClosedItemStatus(item.status)).length,
    pendingCount: items.filter(
      (item) => item.status === "planned" || item.status === "awaiting_start"
    ).length,
    estimatedTotal,
    progressPercent,
  }
}

// ---------------------------------------------------------------------------
// Agrupamento por etapa
// ---------------------------------------------------------------------------

export interface StageGroup<T> {
  stage: string | null
  stageOrder: number
  items: T[]
}

// Agrupa itens por etapa preservando a ordem informada pelo profissional.
// Itens sem etapa ficam em um grupo próprio (stage = null), exibido por último.
export function groupItemsByStage<
  T extends { stage: string | null; stageOrder: number },
>(items: T[]): StageGroup<T>[] {
  const map = new Map<string, StageGroup<T>>()

  for (const item of items) {
    const key = item.stage ?? "__none__"
    const existing = map.get(key)
    if (existing) {
      existing.items.push(item)
    } else {
      map.set(key, {
        stage: item.stage,
        stageOrder: item.stageOrder,
        items: [item],
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    // Grupo sem etapa sempre por último.
    if (a.stage === null && b.stage !== null) return 1
    if (a.stage !== null && b.stage === null) return -1
    if (a.stageOrder !== b.stageOrder) return a.stageOrder - b.stageOrder
    return (a.stage ?? "").localeCompare(b.stage ?? "", "pt-BR")
  })
}

// ---------------------------------------------------------------------------
// Projeção para o odontograma
// ---------------------------------------------------------------------------

// Conjunto de dentes que possuem tratamento PLANEJADO (ainda não concluído).
// Permite ao odontograma indicar visualmente a existência de um plano sem
// alterar o estado clínico do dente (PLANEJADO ≠ REALIZADO).
export function collectPlannedTeeth(
  items: Array<{ toothNumber: string | null; status: string }>
): Set<string> {
  const teeth = new Set<string>()
  for (const item of items) {
    if (!item.toothNumber) continue
    if (isClosedItemStatus(item.status)) continue
    teeth.add(item.toothNumber)
  }
  return teeth
}

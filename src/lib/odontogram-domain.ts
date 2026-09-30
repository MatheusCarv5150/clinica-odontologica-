// ===========================================================================
// Domínio do ODONTOGRAMA — módulo Atendimento (Parte 5).
// ===========================================================================
//
// Fonte da verdade das CONDIÇÕES odontológicas e das regras que ligam
// condições/procedimentos aos dentes e superfícies.
//
// Backend e frontend leem daqui. Nenhuma "cor" é decidida na tela: as
// condições trazem categoria, prioridade e aplicabilidade, e a apresentação
// deriva desses dados.
//
// PRINCÍPIOS OBRIGATÓRIOS:
// - CONDIÇÃO ≠ PROCEDIMENTO. Aqui vivem as CONDIÇÕES. Os procedimentos vêm do
//   catálogo EXISTENTE (`/api/procedures`), nunca duplicado.
// - O sistema não gera diagnóstico. O catálogo apenas classifica o que o
//   profissional registrou.
// - Nenhum item altera implicitamente outras superfícies/dentes: uma condição
//   registrada em "M,O" NÃO é replicada para "V".

import {
  type Dentition,
  type ToothSurface,
  type ToothType,
  isAnteriorTooth,
  normalizeSurfaces,
} from "@/lib/tooth-catalog"

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export type ConditionCategory =
  | "health"
  | "caries"
  | "restoration"
  | "structural"
  | "absence"
  | "endodontics"
  | "prosthesis"
  | "prevention"
  | "periodontal"
  | "other"

export const CONDITION_CATEGORY_LABELS: Record<ConditionCategory, string> = {
  health: "Saúde",
  caries: "Cárie",
  restoration: "Restauração",
  structural: "Estrutural",
  absence: "Ausência",
  endodontics: "Endodontia",
  prosthesis: "Prótese / Implante",
  prevention: "Prevenção",
  periodontal: "Periodontal",
  other: "Outros",
}

// Prioridade clínica: define qual condição representa visualmente o dente
// quando há mais de uma ativa. Quanto MAIOR, mais relevante.
export type ConditionPriority = 1 | 2 | 3 | 4 | 5

// Onde a condição pode ser aplicada.
export type ConditionScope = "tooth" | "surface"

export interface ConditionDefinition {
  code: string
  name: string
  category: ConditionCategory
  scope: ConditionScope
  priority: ConditionPriority
  // Permite selecionar vários dentes de uma vez (ex.: selante em vários
  // molares). Condições "tooth" costumam permitir; algumas não (mobilidade
  // é específica de um dente).
  allowMultipleTeeth: boolean
  // Exige pelo menos uma superfície? (ex.: cárie sem superfície é inválida)
  requiresSurface: boolean
  // Dentições em que a condição se aplica. Vazio = ambas.
  dentitions?: Dentition[]
  // Rótulo curto exibido no chip do dente.
  shortLabel: string
  description: string
}

// Catálogo de condições. Extensível: novas condições são adicionadas aqui,
// sem alterar a UI (que é derivada dos metadados) nem o banco.
export const CONDITION_CATALOG: ConditionDefinition[] = [
  {
    code: "healthy",
    name: "Saudável",
    category: "health",
    scope: "tooth",
    priority: 1,
    allowMultipleTeeth: true,
    requiresSurface: false,
    shortLabel: "Saudável",
    description: "Dente sem alterações registradas.",
  },
  {
    code: "caries",
    name: "Cárie",
    category: "caries",
    scope: "surface",
    priority: 5,
    allowMultipleTeeth: true,
    requiresSurface: true,
    shortLabel: "Cárie",
    description: "Lesão de cárie registrada em superfície específica.",
  },
  {
    code: "restoration",
    name: "Restauração",
    category: "restoration",
    scope: "surface",
    // Representa o estado RESULTANTE do tratamento: quando coexiste com a
    // cárie que a originou, é ela que define o estado atual do dente.
    priority: 5,
    allowMultipleTeeth: true,
    requiresSurface: true,
    shortLabel: "Restauração",
    description: "Restauração presente na superfície indicada.",
  },
  {
    code: "restoration_failure",
    name: "Restauração com falha",
    category: "restoration",
    scope: "surface",
    priority: 5,
    allowMultipleTeeth: true,
    requiresSurface: true,
    shortLabel: "Falha rest.",
    description: "Restauração existente com falha registrada.",
  },
  {
    code: "fracture",
    name: "Fratura",
    category: "structural",
    scope: "surface",
    priority: 5,
    allowMultipleTeeth: false,
    requiresSurface: false,
    shortLabel: "Fratura",
    description: "Fratura registrada no dente ou em superfície específica.",
  },
  {
    code: "wear",
    name: "Desgaste",
    category: "structural",
    scope: "surface",
    priority: 3,
    allowMultipleTeeth: true,
    requiresSurface: true,
    shortLabel: "Desgaste",
    description: "Desgaste registrado na superfície indicada.",
  },
  {
    code: "absent",
    name: "Dente ausente",
    category: "absence",
    scope: "tooth",
    priority: 5,
    allowMultipleTeeth: true,
    requiresSurface: false,
    shortLabel: "Ausente",
    description: "Ausência registrada do dente (não erupcionado/perdido).",
  },
  {
    code: "extracted",
    name: "Dente extraído",
    category: "absence",
    scope: "tooth",
    priority: 5,
    allowMultipleTeeth: true,
    requiresSurface: false,
    shortLabel: "Extraído",
    description: "Extração registrada do dente.",
  },
  {
    code: "impacted",
    name: "Dente impactado",
    category: "absence",
    scope: "tooth",
    priority: 4,
    allowMultipleTeeth: true,
    requiresSurface: false,
    shortLabel: "Impactado",
    description: "Dente impactado (sem via de erupção registrada).",
  },
  {
    code: "included",
    name: "Dente incluso",
    category: "absence",
    scope: "tooth",
    priority: 4,
    allowMultipleTeeth: true,
    requiresSurface: false,
    shortLabel: "Incluso",
    description: "Dente incluso (não irrompido).",
  },
  {
    code: "endodontic",
    name: "Tratamento endodôntico",
    category: "endodontics",
    scope: "tooth",
    priority: 4,
    allowMultipleTeeth: true,
    requiresSurface: false,
    shortLabel: "Endo",
    description: "Tratamento endodôntico (canal) registrado.",
  },
  {
    code: "crown",
    name: "Coroa",
    category: "prosthesis",
    scope: "tooth",
    priority: 4,
    allowMultipleTeeth: true,
    requiresSurface: false,
    shortLabel: "Coroa",
    description: "Coroa registrada no dente.",
  },
  {
    code: "prosthesis",
    name: "Prótese",
    category: "prosthesis",
    scope: "tooth",
    priority: 4,
    allowMultipleTeeth: true,
    requiresSurface: false,
    shortLabel: "Prótese",
    description: "Prótese registrada no dente.",
  },
  {
    code: "implant",
    name: "Implante",
    category: "prosthesis",
    scope: "tooth",
    priority: 5,
    allowMultipleTeeth: true,
    requiresSurface: false,
    shortLabel: "Implante",
    description: "Implante registrado no dente.",
  },
  {
    code: "veneer",
    name: "Faceta",
    category: "prosthesis",
    scope: "surface",
    priority: 3,
    allowMultipleTeeth: true,
    requiresSurface: true,
    shortLabel: "Faceta",
    description: "Faceta registrada na superfície indicada.",
  },
  {
    code: "sealant",
    name: "Selante",
    category: "prevention",
    scope: "surface",
    priority: 2,
    allowMultipleTeeth: true,
    requiresSurface: true,
    shortLabel: "Selante",
    description: "Selante registrado na superfície indicada.",
  },
  {
    code: "mobility",
    name: "Mobilidade",
    category: "periodontal",
    scope: "tooth",
    priority: 3,
    allowMultipleTeeth: false,
    requiresSurface: false,
    shortLabel: "Mobilidade",
    description: "Mobilidade registrada especificamente neste dente.",
  },
  {
    code: "lesion",
    name: "Lesão",
    category: "other",
    scope: "surface",
    priority: 4,
    allowMultipleTeeth: false,
    requiresSurface: false,
    shortLabel: "Lesão",
    description: "Lesão registrada no dente ou em superfície específica.",
  },
  {
    code: "sensitivity",
    name: "Sensibilidade",
    category: "other",
    scope: "tooth",
    priority: 3,
    allowMultipleTeeth: false,
    requiresSurface: false,
    shortLabel: "Sensibilidade",
    description: "Sensibilidade relatada/registrada neste dente.",
  },
  {
    code: "other",
    name: "Outros",
    category: "other",
    scope: "tooth",
    priority: 2,
    allowMultipleTeeth: true,
    requiresSurface: false,
    shortLabel: "Outros",
    description: "Registro livre descrito no campo de observações.",
  },
]

const CONDITION_INDEX = new Map(CONDITION_CATALOG.map((c) => [c.code, c]))

export function getCondition(code: string): ConditionDefinition | null {
  return CONDITION_INDEX.get(code) ?? null
}

export function isConditionCode(code: string): boolean {
  return CONDITION_INDEX.has(code)
}

// Condição "saudável" é o estado neutro: nunca é registrada como evento
// histórico, apenas representa a ausência de condições ativas.
export const HEALTHY_CODE = "healthy"

// ---------------------------------------------------------------------------
// Resolução clínica de condições
// ---------------------------------------------------------------------------

// Condições que RESOLVEM a cárie quando registradas nas mesmas superfícies.
//
// Regra clínica: registrar uma restauração sobre a superfície onde havia
// cárie significa que aquela cárie FOI TRATADA. O evento de cárie NÃO é
// apagado (o histórico é preservado integralmente), mas deixa de ser uma
// condição ATIVA do dente — passando a "resolved".
//
// Isso implementa exatamente o exemplo da especificação:
//   Histórico: 15/06 Cárie registrada → 02/08 Restauração realizada.
//   Estado atual: Restaurado.
export const CARIES_RESOLVING_CODES = [
  "restoration",
  "crown",
  "endodontic",
  "implant",
  "extracted",
]

// Dado o evento que está sendo registrado e os eventos de cárie ativos do
// dente, decide quais cáries passam a "resolved".
//
// A resolução é POR SUPERFÍCIE: uma restauração em "O" não resolve a cárie
// existente em "M". Sem superfície informada (dente como um todo), resolve
// todas as cáries ativas do dente.
export function resolveCariesForEvent(
  newEvent: { code: string; surfaces: string },
  activeCaries: Array<{ id: string; surfaces: string }>
): string[] {
  if (!CARIES_RESOLVING_CODES.includes(newEvent.code)) return []

  const treated = parseSurfaceSet(newEvent.surfaces)

  return activeCaries
    .filter((caries) => {
      // Evento sem superfície (dente inteiro) resolve tudo.
      if (treated.size === 0) return true
      const cariesSurfaces = parseSurfaceSet(caries.surfaces)
      // Cárie sem superfície é resolvida por qualquer tratamento do dente.
      if (cariesSurfaces.size === 0) return true
      for (const surface of cariesSurfaces) {
        if (treated.has(surface)) return true
      }
      return false
    })
    .map((caries) => caries.id)
}

function parseSurfaceSet(csv: string): Set<string> {
  const set = new Set<string>()
  for (const value of String(csv ?? "").split(",")) {
    const upper = value.trim().toUpperCase()
    if (upper) set.add(upper)
  }
  return set
}

// ---------------------------------------------------------------------------
// Validação de aplicabilidade
// ---------------------------------------------------------------------------

export interface ConditionValidationInput {
  code: string
  dentition: Dentition
  toothType: ToothType
  surfaces: ToothSurface[]
}

export type ConditionValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string }

// Valida se uma condição pode ser aplicada a um dente/superfícies. Usado tanto
// no frontend (feedback imediato) quanto no backend (autoridade final).
export function validateConditionApplication(
  input: ConditionValidationInput
): ConditionValidationResult {
  const condition = getCondition(input.code)
  if (!condition) {
    return {
      ok: false,
      code: "UNKNOWN_CONDITION",
      message: `Condição "${input.code}" não existe no catálogo.`,
    }
  }

  if (
    condition.dentitions &&
    condition.dentitions.length > 0 &&
    !condition.dentitions.includes(input.dentition)
  ) {
    return {
      ok: false,
      code: "WRONG_DENTITION",
      message: `A condição "${condition.name}" não se aplica à dentição ${input.dentition}.`,
    }
  }

  if (condition.requiresSurface && input.surfaces.length === 0) {
    return {
      ok: false,
      code: "SURFACE_REQUIRED",
      message: `A condição "${condition.name}" exige ao menos uma superfície.`,
    }
  }

  if (condition.scope === "tooth" && input.surfaces.length > 0 && input.code === HEALTHY_CODE) {
    return {
      ok: false,
      code: "SURFACE_NOT_ALLOWED",
      message: `A condição "${condition.name}" é aplicada ao dente como um todo.`,
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Projeção do estado atual (dado derivado, nunca "a cor pintada")
// ---------------------------------------------------------------------------

export interface ConditionEventLike {
  code: string
  surfaces: string
  status: string
  occurredAt: Date | string
}

// Deriva o estado atual do dente a partir dos eventos de CONDIÇÃO ativos.
//
// Regra: o estado visual principal é a condição ATIVA de maior prioridade.
// As demais condições ativas são preservadas em `conditionCodes` — o detalhe
// do dente mostra TODAS, e o histórico nunca perde nenhuma.
export function projectToothStatus(events: ConditionEventLike[]): {
  status: string
  conditionCodes: string[]
} {
  const activeCodes = new Set<string>()
  let status = HEALTHY_CODE
  let bestPriority = 0

  for (const event of events) {
    if (event.status !== "active") continue
    const condition = getCondition(event.code)
    if (!condition) continue
    activeCodes.add(condition.code)
    if (condition.priority > bestPriority) {
      bestPriority = condition.priority
      status = condition.code
    }
  }

  // Ausente/extraído domina visualmente: é irreversível na projeção.
  if (activeCodes.has("extracted")) status = "extracted"
  else if (activeCodes.has("absent")) status = "absent"

  return { status, conditionCodes: Array.from(activeCodes) }
}

// ---------------------------------------------------------------------------
// Compatibilidade de seleção múltipla
// ---------------------------------------------------------------------------

// Verifica se TODOS os dentes selecionados aceitam a condição (dentição,
// tipo e regras). Ações em massa nunca executam sem esta validação.
export function canApplyToSelection(
  code: string,
  targets: Array<{ number: string; dentition: Dentition; type: ToothType }>
): ConditionValidationResult {
  const condition = getCondition(code)
  if (!condition) {
    return {
      ok: false,
      code: "UNKNOWN_CONDITION",
      message: `Condição "${code}" não existe no catálogo.`,
    }
  }

  if (targets.length > 1 && !condition.allowMultipleTeeth) {
    return {
      ok: false,
      code: "MULTIPLE_NOT_ALLOWED",
      message: `A condição "${condition.name}" não pode ser aplicada a vários dentes de uma vez.`,
    }
  }

  for (const target of targets) {
    if (
      condition.dentitions &&
      condition.dentitions.length > 0 &&
      !condition.dentitions.includes(target.dentition)
    ) {
      return {
        ok: false,
        code: "WRONG_DENTITION",
        message: `A condição "${condition.name}" não se aplica ao dente ${target.number}.`,
      }
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Utilidades de apresentação
// ---------------------------------------------------------------------------

export interface ConditionVisual {
  // Classes de apresentação derivadas da CATEGORIA (não escolhidas à mão por
  // condição): garante consistência visual e evita "20 cores aleatórias".
  dot: string
  chip: string
  surfaceFill: string
}

const CATEGORY_VISUALS: Record<ConditionCategory, ConditionVisual> = {
  health: {
    dot: "bg-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    surfaceFill: "fill-emerald-200 stroke-emerald-600",
  },
  caries: {
    dot: "bg-red-500",
    chip: "border-red-200 bg-red-50 text-red-800",
    surfaceFill: "fill-red-300 stroke-red-700",
  },
  restoration: {
    dot: "bg-blue-500",
    chip: "border-blue-200 bg-blue-50 text-blue-800",
    surfaceFill: "fill-blue-200 stroke-blue-700",
  },
  structural: {
    dot: "bg-amber-500",
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    surfaceFill: "fill-amber-200 stroke-amber-700",
  },
  absence: {
    dot: "bg-gray-500",
    chip: "border-gray-300 bg-gray-100 text-gray-700",
    surfaceFill: "fill-gray-300 stroke-gray-600",
  },
  endodontics: {
    dot: "bg-purple-500",
    chip: "border-purple-200 bg-purple-50 text-purple-800",
    surfaceFill: "fill-purple-200 stroke-purple-700",
  },
  prosthesis: {
    dot: "bg-cyan-600",
    chip: "border-cyan-200 bg-cyan-50 text-cyan-800",
    surfaceFill: "fill-cyan-200 stroke-cyan-700",
  },
  prevention: {
    dot: "bg-teal-500",
    chip: "border-teal-200 bg-teal-50 text-teal-800",
    surfaceFill: "fill-teal-200 stroke-teal-700",
  },
  periodontal: {
    dot: "bg-orange-500",
    chip: "border-orange-200 bg-orange-50 text-orange-800",
    surfaceFill: "fill-orange-200 stroke-orange-700",
  },
  other: {
    dot: "bg-slate-400",
    chip: "border-slate-200 bg-slate-50 text-slate-700",
    surfaceFill: "fill-slate-200 stroke-slate-600",
  },
}

export function getConditionVisual(code: string): ConditionVisual {
  const condition = getCondition(code)
  return CATEGORY_VISUALS[condition?.category ?? "other"]
}

// Estado neutro do dente — nenhuma condição registrada.
export const NEUTRAL_TOOTH_VISUAL: ConditionVisual = {
  dot: "bg-gray-300",
  chip: "border-gray-200 bg-white text-gray-700",
  surfaceFill: "fill-white stroke-gray-400",
}

export function getToothVisual(status: string): ConditionVisual {
  if (status === HEALTHY_CODE) return NEUTRAL_TOOTH_VISUAL
  return getConditionVisual(status)
}

// Agrupa o catálogo por categoria (usado no seletor de condições).
export function groupConditionsByCategory(): Array<{
  category: ConditionCategory
  label: string
  conditions: ConditionDefinition[]
}> {
  const order: ConditionCategory[] = [
    "caries",
    "restoration",
    "structural",
    "absence",
    "endodontics",
    "prosthesis",
    "prevention",
    "periodontal",
    "other",
    "health",
  ]

  return order
    .map((category) => ({
      category,
      label: CONDITION_CATEGORY_LABELS[category],
      conditions: CONDITION_CATALOG.filter((c) => c.category === category),
    }))
    .filter((group) => group.conditions.length > 0)
}

// Resumo textual de superfícies para exibição em listas/timeline.
export function formatSurfaces(
  csv: string | null | undefined,
  toothType?: ToothType
): string {
  const normalized = normalizeSurfaces((csv ?? "").split(","))
  if (!normalized) return ""
  const labels = normalized
    .split(",")
    .map((s) => {
      const surface = s as ToothSurface
      if (!toothType) return surface
      if (surface === "O" && isAnteriorTooth(toothType)) return "Incisal"
      return surface
    })
  return labels.join(" · ")
}

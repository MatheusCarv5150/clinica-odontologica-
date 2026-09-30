// ===========================================================================
// Catálogo de DENTES — módulo Atendimento (Parte 5 — Odontograma).
// ===========================================================================
//
// Este arquivo é a "fonte da verdade" da estrutura dentária:
// numeração FDI/ISO 3950, arcadas, quadrantes, tipos de dente e superfícies.
//
// PRINCÍPIOS:
// - O odontograma é orientado a DADOS. Este módulo só descreve a anatomia
//   odontológica; nenhuma decisão clínica ou de diagnóstico é tomada aqui.
// - FDI é o ÚNICO sistema implementado. O `numberingSystem` existe para
//   permitir, no futuro, outros sistemas (universal, Palmer) sem reescrever
//   o restante do código — mas nenhum sistema alternativo é implementado.
// - Permanente e decídua NUNCA se misturam: cada dente pertence a exatamente
//   uma dentição.

// ---------------------------------------------------------------------------
// Dentição e sistemas de numeração
// ---------------------------------------------------------------------------

export type Dentition = "permanent" | "deciduous"

export const DENTITIONS: Dentition[] = ["permanent", "deciduous"]

export const DENTITION_LABELS: Record<Dentition, string> = {
  permanent: "Permanente",
  deciduous: "Decídua",
}

// Sistema de numeração. Apenas FDI é implementado nesta etapa; o tipo existe
// para não engessar a arquitetura.
export type NumberingSystem = "fdi"

export const DEFAULT_NUMBERING_SYSTEM: NumberingSystem = "fdi"

export const NUMBERING_SYSTEM_LABELS: Record<NumberingSystem, string> = {
  fdi: "FDI / ISO 3950",
}

export function isDentition(value: unknown): value is Dentition {
  return value === "permanent" || value === "deciduous"
}

// ---------------------------------------------------------------------------
// Arcadas e quadrantes
// ---------------------------------------------------------------------------

export type Arch = "upper" | "lower"

export const ARCH_LABELS: Record<Arch, string> = {
  upper: "Arcada superior",
  lower: "Arcada inferior",
}

// Quadrantes FDI: 1..4 (permanente) e 5..8 (decídua).
export type Quadrant = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  1: "Superior direito",
  2: "Superior esquerdo",
  3: "Inferior esquerdo",
  4: "Inferior direito",
  5: "Superior direito (decídua)",
  6: "Superior esquerdo (decídua)",
  7: "Inferior esquerdo (decídua)",
  8: "Inferior direito (decídua)",
}

// ---------------------------------------------------------------------------
// Tipos de dente
// ---------------------------------------------------------------------------

export type ToothType =
  | "central_incisor"
  | "lateral_incisor"
  | "canine"
  | "first_premolar"
  | "second_premolar"
  | "first_molar"
  | "second_molar"
  | "third_molar"

export const TOOTH_TYPE_LABELS: Record<ToothType, string> = {
  central_incisor: "Incisivo central",
  lateral_incisor: "Incisivo lateral",
  canine: "Canino",
  first_premolar: "Primeiro pré-molar",
  second_premolar: "Segundo pré-molar",
  first_molar: "Primeiro molar",
  second_molar: "Segundo molar",
  third_molar: "Terceiro molar",
}

// ---------------------------------------------------------------------------
// Superfícies dentárias
// ---------------------------------------------------------------------------

// M = Mesial, D = Distal, O = Oclusal, V = Vestibular, L = Lingual/Palatina.
export type ToothSurface = "M" | "D" | "O" | "V" | "L"

export const TOOTH_SURFACES: ToothSurface[] = ["M", "D", "O", "V", "L"]

export const SURFACE_LABELS: Record<ToothSurface, string> = {
  M: "Mesial",
  D: "Distal",
  O: "Oclusal",
  V: "Vestibular",
  L: "Lingual / Palatina",
}

// Nome conforme a posição do dente: em dentes anteriores a face "O" é
// chamada de incisal ("I") na convenção clínica. Mantemos o código "O" para
// não quebrar os dados, mas exibimos o rótulo correto.
export const INCISAL_LABEL = "Incisal"

export function isToothSurface(value: unknown): value is ToothSurface {
  return (
    value === "M" ||
    value === "D" ||
    value === "O" ||
    value === "V" ||
    value === "L"
  )
}

// Superfícies de dentes anteriores não possuem face oclusal. A seleção é
// adaptada na apresentação (rótulo "Incisal"), sem alterar o código.
export function getSurfaceLabel(
  surface: ToothSurface,
  type: ToothType
): string {
  if (surface === "O" && isAnteriorTooth(type)) return INCISAL_LABEL
  return SURFACE_LABELS[surface]
}

// Dentes anteriores: incisivos e caninos.
export function isAnteriorTooth(type: ToothType): boolean {
  return (
    type === "central_incisor" ||
    type === "lateral_incisor" ||
    type === "canine"
  )
}

// Normaliza uma lista de superfícies: remove inválidas/duplicadas, ordena
// sempre na mesma sequência clínica (M, D, O, V, L) e devolve CSV estável.
// O CSV normalizado é o que vai para o banco — evita "M,O" vs "O,M".
export function normalizeSurfaces(input: readonly string[]): string {
  const set = new Set<ToothSurface>()
  for (const value of input) {
    const upper = String(value).toUpperCase()
    if (isToothSurface(upper)) set.add(upper)
  }
  return TOOTH_SURFACES.filter((s) => set.has(s)).join(",")
}

export function parseSurfaces(csv: string | null | undefined): ToothSurface[] {
  if (!csv) return []
  return normalizeSurfaces(csv.split(",")).split(",").filter(Boolean) as ToothSurface[]
}

// ---------------------------------------------------------------------------
// Definição do dente
// ---------------------------------------------------------------------------

export interface ToothDefinition {
  // Número FDI (string para preservar o "0" e evitar ambiguidades).
  number: string
  dentition: Dentition
  arch: Arch
  quadrant: Quadrant
  type: ToothType
  // Ordem posicional dentro do quadrante (1 = mais próximo da linha média).
  positionInQuadrant: number
  // Posição global na arcada (0 à esquerda → n à direita na tela).
  archIndex: number
}

// Tabelas estáticas: evita cálculos repetidos e torna a numeração explícita
// e auditável (importante em software clínico).
const PERMANENT_QUADRANTS: Record<1 | 2 | 3 | 4, string[]> = {
  1: ["11", "12", "13", "14", "15", "16", "17", "18"],
  2: ["21", "22", "23", "24", "25", "26", "27", "28"],
  3: ["31", "32", "33", "34", "35", "36", "37", "38"],
  4: ["41", "42", "43", "44", "45", "46", "47", "48"],
}

const DECIDUOUS_QUADRANTS: Record<5 | 6 | 7 | 8, string[]> = {
  5: ["51", "52", "53", "54", "55"],
  6: ["61", "62", "63", "64", "65"],
  7: ["71", "72", "73", "74", "75"],
  8: ["81", "82", "83", "84", "85"],
}

const PERMANENT_TYPES: ToothType[] = [
  "central_incisor",
  "lateral_incisor",
  "canine",
  "first_premolar",
  "second_premolar",
  "first_molar",
  "second_molar",
  "third_molar",
]

const DECIDUOUS_TYPES: ToothType[] = [
  "central_incisor",
  "lateral_incisor",
  "canine",
  "first_molar",
  "second_molar",
]

function buildTooth(
  number: string,
  dentition: Dentition,
  quadrant: Quadrant,
  type: ToothType,
  positionInQuadrant: number,
  archIndex: number
): ToothDefinition {
  const arch: Arch = quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6
    ? "upper"
    : "lower"
  return { number, dentition, arch, quadrant, type, positionInQuadrant, archIndex }
}

// Ordem de exibição da arcada superior (da direita do paciente para a
// esquerda, como em um odontograma clínico): 18..11 | 21..28.
const UPPER_PERMANENT_ORDER = [
  ...PERMANENT_QUADRANTS[1].slice().reverse(),
  ...PERMANENT_QUADRANTS[2],
]

// Ordem de exibição da arcada inferior: 48..41 | 31..38.
const LOWER_PERMANENT_ORDER = [
  ...PERMANENT_QUADRANTS[4].slice().reverse(),
  ...PERMANENT_QUADRANTS[3],
]

const UPPER_DECIDUOUS_ORDER = [
  ...DECIDUOUS_QUADRANTS[5].slice().reverse(),
  ...DECIDUOUS_QUADRANTS[6],
]

const LOWER_DECIDUOUS_ORDER = [
  ...DECIDUOUS_QUADRANTS[8].slice().reverse(),
  ...DECIDUOUS_QUADRANTS[7],
]

function buildDentition(
  order: { upper: string[]; lower: string[] },
  dentition: Dentition,
  types: ToothType[],
  quadrants: Record<number, string[]>
): ToothDefinition[] {
  const definitions: ToothDefinition[] = []

  for (const arch of ["upper", "lower"] as const) {
    const numbers = order[arch]
    numbers.forEach((number, archIndex) => {
      const quadrant = Number(number[0]) as Quadrant
      const positionInQuadrant = quadrants[quadrant].indexOf(number) + 1
      const type = types[positionInQuadrant - 1]
      definitions.push(
        buildTooth(number, dentition, quadrant, type, positionInQuadrant, archIndex)
      )
    })
  }

  return definitions
}

export const PERMANENT_TEETH: ToothDefinition[] = buildDentition(
  { upper: UPPER_PERMANENT_ORDER, lower: LOWER_PERMANENT_ORDER },
  "permanent",
  PERMANENT_TYPES,
  PERMANENT_QUADRANTS
)

export const DECIDUOUS_TEETH: ToothDefinition[] = buildDentition(
  { upper: UPPER_DECIDUOUS_ORDER, lower: LOWER_DECIDUOUS_ORDER },
  "deciduous",
  DECIDUOUS_TYPES,
  DECIDUOUS_QUADRANTS
)

const TOOTH_INDEX = new Map<string, ToothDefinition>(
  [...PERMANENT_TEETH, ...DECIDUOUS_TEETH].map((tooth) => [tooth.number, tooth])
)

export function getToothDefinition(number: string): ToothDefinition | null {
  return TOOTH_INDEX.get(String(number)) ?? null
}

export function isKnownToothNumber(number: string): boolean {
  return TOOTH_INDEX.has(String(number))
}

export function listTeeth(dentition: Dentition): ToothDefinition[] {
  return dentition === "permanent" ? PERMANENT_TEETH : DECIDUOUS_TEETH
}

// Seletores de arcada/todos os dentes — usados nas ações em massa.
export function teethByArch(dentition: Dentition, arch: Arch): ToothDefinition[] {
  return listTeeth(dentition).filter((t) => t.arch === arch)
}

// Descrição humana do dente, usada no painel de detalhe.
export function describeTooth(number: string): string {
  const tooth = getToothDefinition(number)
  if (!tooth) return `Dente ${number}`
  const arch = tooth.arch === "upper" ? "superior" : "inferior"
  const side = [1, 4, 5, 8].includes(tooth.quadrant) ? "direito" : "esquerdo"
  return `${TOOTH_TYPE_LABELS[tooth.type]} ${arch} ${side}`
}

// ---------------------------------------------------------------------------
// Grupos de exibição do odontograma (arcada × lado)
// ---------------------------------------------------------------------------

export interface OdontogramRow {
  arch: Arch
  // Lado do paciente (direito/esquerdo) exibido na interface.
  side: "right" | "left"
  teeth: ToothDefinition[]
}

// Monta as duas linhas (superior/inferior) com o lado direito e o lado
// esquerdo do paciente, como em um odontograma clínico tradicional.
export function buildOdontogramRows(dentition: Dentition): OdontogramRow[] {
  const teeth = listTeeth(dentition)
  const upper = teeth.filter((t) => t.arch === "upper")
  const lower = teeth.filter((t) => t.arch === "lower")

  return [
    { arch: "upper", side: "right", teeth: upper.slice(0, upper.length / 2) },
    { arch: "upper", side: "left", teeth: upper.slice(upper.length / 2) },
    { arch: "lower", side: "right", teeth: lower.slice(0, lower.length / 2) },
    { arch: "lower", side: "left", teeth: lower.slice(lower.length / 2) },
  ]
}

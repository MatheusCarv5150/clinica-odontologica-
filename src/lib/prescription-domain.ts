// ===========================================================================
// DOMÍNIO DA PRESCRIÇÃO — Módulo Atendimento (Parte 10.2).
//
// Regras puras e nomenclatura. NENHUM medicamento é sugerido, inserido ou
// inferido automaticamente: o sistema apenas registra o que o profissional
// informa. As listas de via de administração/unidade servem somente como
// conveniência de digitação e permanecem em texto livre no banco.
// ===========================================================================

export type PrescriptionStatus = "draft" | "issued" | "cancelled"

export const PRESCRIPTION_STATUSES: PrescriptionStatus[] = [
  "draft",
  "issued",
  "cancelled",
]

export const PRESCRIPTION_STATUS_META: Record<
  PrescriptionStatus,
  {
    label: string
    description: string
    className: string
    dot: string
  }
> = {
  draft: {
    label: "Rascunho",
    description: "Prescrição em elaboração — ainda não emitida ao paciente.",
    className: "border-gray-300 bg-gray-100 text-gray-700",
    dot: "bg-gray-400",
  },
  issued: {
    label: "Emitida",
    description: "Prescrição emitida e registrada no prontuário.",
    className: "border-green-200 bg-green-50 text-green-800",
    dot: "bg-green-500",
  },
  cancelled: {
    label: "Cancelada",
    description: "Prescrição cancelada — o registro original é preservado.",
    className: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500",
  },
}

export function isPrescriptionStatus(
  value: unknown
): value is PrescriptionStatus {
  return (
    typeof value === "string" &&
    (PRESCRIPTION_STATUSES as string[]).includes(value)
  )
}

export function getPrescriptionStatusMeta(status: string) {
  return (
    PRESCRIPTION_STATUS_META[status as PrescriptionStatus] ??
    PRESCRIPTION_STATUS_META.draft
  )
}

// Prescrição emitida/cancelada não pode ser editada livremente: deve ser
// cancelada (registro preservado) ou uma nova prescrição deve ser criada.
export function canEditPrescription(status: string): boolean {
  return status === "draft"
}

export function canCancelPrescription(status: string): boolean {
  return status === "issued" || status === "draft"
}

// ---------------------------------------------------------------------------
// Vias de administração e unidades (conveniência de UI, não regra de negócio)
// ---------------------------------------------------------------------------

export const PRESCRIPTION_ROUTES: string[] = [
  "Oral",
  "Sublingual",
  "Tópica",
  "Injetável",
  "Intramuscular",
  "Intravenosa",
  "Subcutânea",
  "Inalatória",
  "Nasal",
  "Oftálmica",
  "Otológica",
  "Retal",
  "Vaginal",
  "Outra",
]

export const PRESCRIPTION_UNITS: string[] = [
  "comprimido(s)",
  "cápsula(s)",
  "gota(s)",
  "ml",
  "mg",
  "g",
  "sachê(s)",
  "ampola(s)",
  "frasco(s)",
  "aplicação(ões)",
  "tubo(s)",
  "unidade(s)",
]

// ---------------------------------------------------------------------------
// Apresentação resumida do item (ex.: "Amoxicilina 500 mg — 1 cápsula, 8 em
// 8 horas por 7 dias"). Apenas compõe textos já informados; não inventa nada.
// ---------------------------------------------------------------------------

export interface PrescriptionItemLike {
  name: string
  concentration?: string | null
  presentation?: string | null
  dose?: string | null
  frequency?: string | null
  duration?: string | null
  quantity?: number | null
  unit?: string | null
}

export function formatPrescriptionItemLine(item: PrescriptionItemLike): string {
  const head = [item.name, item.concentration].filter(Boolean).join(" ")
  const parts: string[] = []

  if (item.dose) parts.push(item.dose)
  if (item.frequency) parts.push(item.frequency)
  if (item.duration) parts.push(`por ${item.duration}`)

  const posology = parts.join(", ")
  const quantity =
    item.quantity !== null && item.quantity !== undefined
      ? `${formatQuantity(item.quantity)} ${item.unit ?? ""}`.trim()
      : ""

  return [head, posology, quantity].filter(Boolean).join(" — ")
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",")
}

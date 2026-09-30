import { z } from "zod"

// ===========================================================================
// Validação da PRESCRIÇÃO — Módulo Atendimento (Parte 10.2).
//
// O cliente NUNCA define:
// - o paciente (resolvido do atendimento no servidor);
// - o atendimento (resolvido no servidor quando informado);
// - a data de emissão/cancelamento (gerada no servidor).
//
// Nenhum medicamento é sugerido ou inserido automaticamente: o sistema apenas
// registra o que o profissional informar.
// ===========================================================================

const optionalText = (max: number) =>
  z
    .string()
    .max(max, `Texto deve ter no máximo ${max} caracteres`)
    .optional()
    .nullable()
    .transform((value) => {
      if (value === undefined || value === null) return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

const prescriptionItemSchema = z.object({
  // Nome do medicamento/produto: único campo obrigatório do item.
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do medicamento.")
    .max(200, "Nome muito longo."),
  activeIngredient: optionalText(200),
  presentation: optionalText(80),
  concentration: optionalText(80),
  quantity: z
    .number()
    .min(0, "Quantidade não pode ser negativa.")
    .max(100_000, "Quantidade acima do limite.")
    .optional()
    .nullable(),
  unit: optionalText(40),
  route: optionalText(60),
  dose: optionalText(120),
  frequency: optionalText(120),
  duration: optionalText(120),
  instructions: optionalText(1000),
  observations: optionalText(1000),
})

export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>

const prescriptionBaseSchema = z.object({
  // Itens/medicamentos: uma prescrição precisa de ao menos um.
  items: z
    .array(prescriptionItemSchema)
    .min(1, "Adicione pelo menos um medicamento à prescrição.")
    .max(50, "Limite de 50 itens por prescrição."),
  notes: optionalText(2000),
  guidance: optionalText(2000),
  professionalName: optionalText(120),
  // Emitir imediatamente? Se false, o registro fica como rascunho.
  issue: z.boolean().default(true),
})

export const createPrescriptionSchema = prescriptionBaseSchema

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>

export const updatePrescriptionSchema = z.object({
  items: z.array(prescriptionItemSchema).min(1).max(50).optional(),
  notes: optionalText(2000),
  guidance: optionalText(2000),
  professionalName: optionalText(120),
  // Emitir a prescrição (rascunho -> emitida).
  issue: z.boolean().optional(),
})

export type UpdatePrescriptionInput = z.infer<
  typeof updatePrescriptionSchema
>

export const cancelPrescriptionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Informe o motivo do cancelamento.")
    .max(500, "Motivo muito longo."),
  cancelledByName: optionalText(120),
})

export type CancelPrescriptionInput = z.infer<
  typeof cancelPrescriptionSchema
>

// ---------------------------------------------------------------------------
// Respostas (contrato com o frontend)
// ---------------------------------------------------------------------------

export interface PrescriptionItemView {
  id: string
  name: string
  activeIngredient: string | null
  presentation: string | null
  concentration: string | null
  quantity: number | null
  unit: string | null
  route: string | null
  dose: string | null
  frequency: string | null
  duration: string | null
  instructions: string | null
  observations: string | null
  position: number
}

export interface PrescriptionLogView {
  id: string
  event: string
  label: string
  notes: string | null
  performedByName: string | null
  createdAt: string
}

export interface PrescriptionView {
  id: string
  status: string
  notes: string | null
  guidance: string | null
  professionalName: string | null
  appointmentId: string | null
  appointmentCode: string | null
  issuedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  cancelledByName: string | null
  createdAt: string
  updatedAt: string
  items: PrescriptionItemView[]
  logs: PrescriptionLogView[]
}

export interface PrescriptionsResponse {
  patient: { id: string; fullName: string; cpf: string }
  appointment: {
    id: string
    code: string
    date: string
    time: string | null
  } | null
  professional: { id: string; name: string } | null
  prescriptions: PrescriptionView[]
  totals: {
    prescriptionsCount: number
    issuedCount: number
    cancelledCount: number
    itemsCount: number
  }
}

// Alias usado pela UI (mesmo contrato do endpoint).
export type PrescriptionsApiResponse = PrescriptionsResponse

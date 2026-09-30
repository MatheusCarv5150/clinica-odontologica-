import { z } from "zod"

// ===========================================================================
// Validação do PLANO DE TRATAMENTO — Módulo Atendimento (Parte 10.1).
//
// O cliente NUNCA define:
// - o paciente (resolvido do atendimento no servidor);
// - o snapshot do procedimento (copiado do catálogo no servidor);
// - a data de criação (gerada no servidor).
//
// A validação de existência do procedimento e a cooperação com o odontograma
// são feitas no SERVIÇO — autoridade final.
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

const toothNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{2}$/, "Número do dente deve seguir o padrão FDI (ex.: 26).")

const surfacesSchema = z
  .array(z.string().trim().regex(/^[MDOVL]$/i, "Superfície inválida."))
  .max(5, "Um dente possui no máximo 5 superfícies.")
  .optional()
  .default([])

const dentitionSchema = z.enum(["permanent", "deciduous"])

const prioritySchema = z.enum(["low", "medium", "high", "urgent"])
const itemStatusSchema = z.enum([
  "planned",
  "awaiting_start",
  "in_progress",
  "partially_done",
  "completed",
  "cancelled",
  "not_done",
])
const planStatusSchema = z.enum(["draft", "active", "completed", "cancelled"])

// ---------------------------------------------------------------------------
// Criar / atualizar plano
// ---------------------------------------------------------------------------

export const createTreatmentPlanSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Informe um título para o plano.")
    .max(160, "Título muito longo."),
  description: optionalText(2000),
  notes: optionalText(2000),
  status: planStatusSchema.default("active"),
  professionalName: optionalText(120),
  // Data de referência (YYYY-MM-DD) — validada e convertida no serviço.
  plannedDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
    .optional()
    .nullable(),
})

export type CreateTreatmentPlanInput = z.infer<
  typeof createTreatmentPlanSchema
>

export const updateTreatmentPlanSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  description: optionalText(2000),
  notes: optionalText(2000),
  status: planStatusSchema.optional(),
  professionalName: optionalText(120),
  plannedDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
    .optional()
    .nullable(),
})

export type UpdateTreatmentPlanInput = z.infer<
  typeof updateTreatmentPlanSchema
>

// ---------------------------------------------------------------------------
// Criar / atualizar item do plano
// ---------------------------------------------------------------------------

export const createTreatmentPlanItemSchema = z
  .object({
    // Procedimento do catálogo REAL (opcional: há itens sem procedimento).
    procedureId: z.string().trim().min(1).optional().nullable(),
    // Descrição livre quando o item não referencia o catálogo — ou complemento.
    description: optionalText(500),
    toothNumber: toothNumberSchema.optional().nullable(),
    dentition: dentitionSchema.optional().nullable(),
    surfaces: surfacesSchema,
    priority: prioritySchema.default("medium"),
    expectedPrice: z
      .number()
      .min(0, "Valor não pode ser negativo.")
      .max(1_000_000, "Valor acima do limite permitido.")
      .optional()
      .nullable(),
    quantity: z.number().int().min(1).max(999).default(1),
    stage: optionalText(120),
    stageOrder: z.number().int().min(0).max(999).default(0),
    position: z.number().int().min(0).max(9999).default(0),
    status: itemStatusSchema.default("planned"),
    plannedDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
      .optional()
      .nullable(),
    notes: optionalText(1000),
  })
  .superRefine((value, ctx) => {
    // O item precisa de ALGO que o identifique: procedimento ou descrição.
    if (!value.procedureId && !value.description) {
      ctx.addIssue({
        code: "custom",
        path: ["description"],
        message: "Informe o procedimento ou descreva o item do plano.",
      })
    }
    // Superfície exige dente (mesma regra dos procedimentos do atendimento).
    if (value.surfaces && value.surfaces.length > 0 && !value.toothNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["toothNumber"],
        message: "Informe o dente para registrar superfícies.",
      })
    }
  })

export type CreateTreatmentPlanItemInput = z.infer<
  typeof createTreatmentPlanItemSchema
>

export const updateTreatmentPlanItemSchema = z
  .object({
    procedureId: z.string().trim().min(1).optional().nullable(),
    description: optionalText(500),
    toothNumber: toothNumberSchema.optional().nullable(),
    dentition: dentitionSchema.optional().nullable(),
    surfaces: surfacesSchema,
    priority: prioritySchema.optional(),
    expectedPrice: z.number().min(0).max(1_000_000).optional().nullable(),
    quantity: z.number().int().min(1).max(999).optional(),
    stage: optionalText(120),
    stageOrder: z.number().int().min(0).max(999).optional(),
    position: z.number().int().min(0).max(9999).optional(),
    status: itemStatusSchema.optional(),
    plannedDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
      .optional()
      .nullable(),
    notes: optionalText(1000),
    // Motivo informado ao alterar status (auditoria de replanejamento).
    statusReason: optionalText(500),
    performedByName: optionalText(120),
  })
  .superRefine((value, ctx) => {
    if (value.surfaces && value.surfaces.length > 0 && !value.toothNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["toothNumber"],
        message: "Informe o dente para registrar superfícies.",
      })
    }
  })

export type UpdateTreatmentPlanItemInput = z.infer<
  typeof updateTreatmentPlanItemSchema
>

// ---------------------------------------------------------------------------
// Respostas (contrato com o frontend)
// ---------------------------------------------------------------------------

export interface TreatmentPlanItemView {
  id: string
  planId: string
  procedureId: string | null
  procedureNameSnapshot: string
  procedureCodeSnapshot: string | null
  toothNumber: string | null
  dentition: string | null
  surfaces: string[]
  description: string | null
  priority: string
  expectedPrice: number | null
  quantity: number
  stage: string | null
  stageOrder: number
  position: number
  status: string
  plannedDate: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface TreatmentPlanChangeView {
  id: string
  field: string
  label: string
  oldValue: string | null
  newValue: string | null
  reason: string | null
  changedByName: string | null
  changedAt: string
}

export interface TreatmentPlanView {
  id: string
  title: string
  description: string | null
  notes: string | null
  status: string
  professionalName: string | null
  plannedDate: string | null
  createdInAppointmentId: string | null
  createdAt: string
  updatedAt: string
  items: TreatmentPlanItemView[]
  summary: {
    totalItems: number
    plannedCount: number
    awaitingCount: number
    inProgressCount: number
    partiallyDoneCount: number
    completedCount: number
    cancelledCount: number
    notDoneCount: number
    openCount: number
    pendingCount: number
    estimatedTotal: number
    progressPercent: number
  }
  changes: TreatmentPlanChangeView[]
}

export interface TreatmentPlansResponse {
  patient: { id: string; fullName: string; cpf: string }
  plans: TreatmentPlanView[]
  // Dentes com tratamento planejado (não concluído) — projetado para o
  // odontograma indicar a existência de plano sem alterar o estado clínico.
  plannedTeeth: string[]
  totals: {
    plansCount: number
    openItemsCount: number
    completedItemsCount: number
    estimatedTotal: number
  }
}

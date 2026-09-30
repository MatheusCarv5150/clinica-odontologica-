import { z } from "zod"

// ===========================================================================
// Validação da ANAMNESE (Parte 4) — usada pelo backend antes de qualquer
// escrita. Validação defensiva: o cliente nunca define o paciente nem a
// versão do registro clínico — isso é resolvido no servidor.
// ===========================================================================

const answerValueSchema = z.enum(["yes", "no", "unknown"])
const itemTypeSchema = z.enum(["condition", "allergy", "medication", "surgery"])
const intensitySchema = z.enum(["none", "mild", "moderate", "severe"])
const anxietySchema = z.enum(["none", "mild", "moderate", "severe"])

// Texto opcional: normaliza "" para null (evita lixo no banco) e limita o
// tamanho para proteger a API contra payloads abusivos.
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

const requiredText = (max: number, field: string) =>
  z
    .string()
    .trim()
    .min(1, `${field} é obrigatório`)
    .max(max, `${field} deve ter no máximo ${max} caracteres`)

// ---------------------------------------------------------------------------
// Respostas estruturadas
// ---------------------------------------------------------------------------

export const anamnesisAnswerInputSchema = z.object({
  questionKey: requiredText(80, "Pergunta"),
  section: z.enum(["medical_history", "habits", "dental_history"]),
  value: answerValueSchema,
  note: optionalText(1000),
})

export type AnamnesisAnswerInput = z.infer<typeof anamnesisAnswerInputSchema>

// ---------------------------------------------------------------------------
// Itens clínicos (condições, alergias, medicamentos, cirurgias)
// ---------------------------------------------------------------------------

export const anamnesisItemInputSchema = z
  .object({
    type: itemTypeSchema,
    itemKey: optionalText(80),
    label: requiredText(200, "Descrição"),
    reaction: optionalText(300),
    dosage: optionalText(120),
    frequency: optionalText(120),
    purpose: optionalText(300),
    year: optionalText(20),
    reason: optionalText(500),
    active: z.boolean().optional().default(true),
    note: optionalText(1000),
  })
  // Alergias e medicamentos exigem descrição explícita; condições e cirurgias
  // também usam "label" obrigatório (já garantido acima).
  .transform((item) => ({
    ...item,
    // Campos específicos só fazem sentido no tipo correspondente; limpamos os
    // demais para não persistir informação cruzada por engano.
    reaction: item.type === "allergy" ? item.reaction : null,
    dosage: item.type === "medication" ? item.dosage : null,
    frequency: item.type === "medication" ? item.frequency : null,
    purpose: item.type === "medication" ? item.purpose : null,
    year: item.type === "surgery" ? item.year : null,
    reason: item.type === "surgery" ? item.reason : null,
    active: item.type === "medication" ? item.active : true,
  }))

export type AnamnesisItemInput = z.infer<typeof anamnesisItemInputSchema>

// ---------------------------------------------------------------------------
// Perfil clínico do paciente (dado permanente — nova versão a cada gravação)
// ---------------------------------------------------------------------------

export const clinicalProfileSchema = z.object({
  answers: z.array(anamnesisAnswerInputSchema).max(80).default([]),
  conditions: z.array(anamnesisItemInputSchema).max(50).default([]),
  allergies: z.array(anamnesisItemInputSchema).max(50).default([]),
  medications: z.array(anamnesisItemInputSchema).max(80).default([]),
  surgeries: z.array(anamnesisItemInputSchema).max(50).default([]),
  notes: optionalText(4000),
})

export type ClinicalProfileInput = z.infer<typeof clinicalProfileSchema>

// ---------------------------------------------------------------------------
// Dados específicos do atendimento atual
// ---------------------------------------------------------------------------

export const sessionAnamnesisSchema = z.object({
  chiefComplaint: optionalText(1000),
  visitReason: optionalText(1000),
  complaintHistory: optionalText(2000),
  complaintOnset: optionalText(200),
  complaintDuration: optionalText(200),
  complaintIntensity: intensitySchema.optional().nullable(),
  associatedSymptoms: optionalText(1000),
  complaintNotes: optionalText(2000),
  habitsNotes: optionalText(2000),
  dentalNotes: optionalText(2000),
  anxietyLevel: anxietySchema.optional().nullable(),
  anxietyNotes: optionalText(1000),
  notes: optionalText(4000),
  sessionAnswers: z.array(anamnesisAnswerInputSchema).max(80).default([]),
})

export type SessionAnamnesisInput = z.infer<typeof sessionAnamnesisSchema>

// ---------------------------------------------------------------------------
// Payload completo de salvamento
// ---------------------------------------------------------------------------

export const saveAnamnesisSchema = z.object({
  // Dados permanentes do paciente: só são versionados quando enviados.
  clinical: clinicalProfileSchema.optional(),
  session: sessionAnamnesisSchema,
  // Nome do responsável pela alteração. Quando não há autenticação ativa, o
  // cliente pode informar o profissional responsável; o servidor nunca
  // inventa um usuário.
  responsibleName: optionalText(120),
})

export type SaveAnamnesisInput = z.infer<typeof saveAnamnesisSchema>

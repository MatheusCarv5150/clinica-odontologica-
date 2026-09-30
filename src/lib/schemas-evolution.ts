import { z } from "zod"

// ===========================================================================
// Validação da EVOLUÇÃO CLÍNICA (Parte 6).
//
// Usada pelo backend antes de qualquer escrita. O cliente nunca define:
// - o paciente (resolvido do atendimento);
// - o profissional (resolvido do contexto de autenticação ou informado
//   pelo cliente como rótulo);
// - a data/hora (gerada pelo servidor);
// - o status de finalização (controlado pelo backend).
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

// ---------------------------------------------------------------------------
// Queixa / motivo da consulta
// ---------------------------------------------------------------------------

export const chiefComplaintSchema = z.object({
  // Texto livre do profissional. Pode ser pré-preenchido a partir da
  // anamnese, mas o registro final é sempre explicitamente salvo.
  text: optionalText(2000),
  // Referência à queixa registrada na anamnese (sugestão, não obrigatório).
  anamnesisRef: z.string().optional(),
})

export type ChiefComplaintInput = z.infer<typeof chiefComplaintSchema>

// ---------------------------------------------------------------------------
// Achados clínicos
// ---------------------------------------------------------------------------

export const clinicalFindingsSchema = z.object({
  text: optionalText(4000),
})

export type ClinicalFindingsInput = z.infer<typeof clinicalFindingsSchema>

// ---------------------------------------------------------------------------
// Avaliação / diagnóstico
// ---------------------------------------------------------------------------

export const evaluationSchema = z.object({
  text: optionalText(4000),
  // O diagnóstico é responsabilidade do profissional. Nenhum valor
  // automático é gerado pelo sistema.
})

export type EvaluationInput = z.infer<typeof evaluationSchema>

// ---------------------------------------------------------------------------
// Conduta
// ---------------------------------------------------------------------------

export const conductSchema = z.object({
  text: optionalText(4000),
})

export type ConductInput = z.infer<typeof conductSchema>

// ---------------------------------------------------------------------------
// Procedimento realizado (vinculado ao catálogo existente)
// ---------------------------------------------------------------------------

export const procedureRecordSchema = z.object({
  // Referência ao procedimento do catálogo existente.
  procedureId: z.string().min(1, "Procedimento é obrigatório"),
  // Snapshot do nome no momento do registro (preserva histórico mesmo
  // se o catálogo for renomeado).
  procedureNameSnapshot: z.string().min(1, "Nome do procedimento é obrigatório"),
  // Dente referenciado (FDI/ISO).
  toothNumber: z
    .string()
    .trim()
    .regex(/^\d{2}$/, "Número do dente deve seguir o padrão FDI (ex.: 26).")
    .optional(),
  // Dentição.
  dentition: z.enum(["permanent", "deciduous"]).optional(),
  // Superfícies (ex.: "O", "M,O", "V,L").
  surfaces: z
    .array(z.string().trim().regex(/^[MDOVL]$/i, "Superfície inválida."))
    .max(5)
    .optional()
    .default([]),
  // Status do procedimento neste atendimento.
  status: z.enum(["planned", "performed", "not_performed", "cancelled"]).default("performed"),
  // Material utilizado (texto livre, sem controle de estoque).
  material: optionalText(500),
  // Observação clínica sobre este procedimento.
  notes: optionalText(1000),
})

export type ProcedureRecordInput = z.infer<typeof procedureRecordSchema>

// ---------------------------------------------------------------------------
// Registro de evolução clínica
// ---------------------------------------------------------------------------

export const evolutionEntrySchema = z.object({
  text: optionalText(4000),
})

export type EvolutionEntryInput = z.infer<typeof evolutionEntrySchema>

// ---------------------------------------------------------------------------
// Orientações ao paciente
// ---------------------------------------------------------------------------

export const patientGuidanceSchema = z.object({
  text: optionalText(4000),
})

export type PatientGuidanceInput = z.infer<typeof patientGuidanceSchema>

// ---------------------------------------------------------------------------
// Intercorrências
// ---------------------------------------------------------------------------

export const intercurrentSchema = z.object({
  // Se houve intercorrência.
  hasIntercurrent: z.boolean(),
  // Descrição da intercorrência (obrigatório quando hasIntercurrent=true).
  description: optionalText(2000),
})

export type IntercurrentInput = z.infer<typeof intercurrentSchema>

// ---------------------------------------------------------------------------
// Observações adicionais
// ---------------------------------------------------------------------------

export const observationsSchema = z.object({
  text: optionalText(4000),
})

export type ObservationsInput = z.infer<typeof observationsSchema>

// ---------------------------------------------------------------------------
// Payload completo de evolução
// ---------------------------------------------------------------------------

export const saveEvolutionSchema = z.object({
  chiefComplaint: chiefComplaintSchema.optional(),
  clinicalFindings: clinicalFindingsSchema.optional(),
  evaluation: evaluationSchema.optional(),
  conduct: conductSchema.optional(),
  procedures: z.array(procedureRecordSchema).max(20).default([]),
  evolution: evolutionEntrySchema.optional(),
  guidance: patientGuidanceSchema.optional(),
  intercurrent: intercurrentSchema.optional(),
  observations: observationsSchema.optional(),
  // Nome do profissional responsável pela alteração.
  responsibleName: optionalText(120),
  // Se true, finaliza o atendimento. Se false, salva como rascunho.
  finalize: z.boolean().default(false),
})

export type SaveEvolutionInput = z.infer<typeof saveEvolutionSchema>

// ---------------------------------------------------------------------------
// Resposta da API (somente leitura)
// ---------------------------------------------------------------------------

export interface ProcedureRecordView {
  id: string
  procedureId: string
  procedureNameSnapshot: string
  toothNumber: string | null
  dentition: string | null
  surfaces: string[]
  status: string
  material: string | null
  notes: string | null
  professionalName: string | null
  appointmentId: string
  occurredAt: string
}

export interface EvolutionView {
  id: string
  appointmentId: string
  patientId: string
  chiefComplaint: string | null
  clinicalFindings: string | null
  evaluation: string | null
  conduct: string | null
  procedures: ProcedureRecordView[]
  evolution: string | null
  guidance: string | null
  intercurrentHas: boolean
  intercurrentDescription: string | null
  observations: string | null
  finalized: boolean
  finalizedAt: string | null
  finalizedById: string | null
  finalizedByName: string | null
  createdById: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export interface EvolutionResponse {
  appointment: {
    id: string
    code: string
    date: string
    time: string | null
    status: string
  }
  patient: {
    id: string
    fullName: string
    cpf: string
    birthDate: string | null
    age: number | null
  }
  professional: { id: string; name: string } | null
  proceduresScheduled: Array<{ id: string; name: string; quantity: number }>
  evolution: EvolutionView | null
  // Referências da anamnese para pré-preenchimento (sugestão, não obrigatório).
  anamnesisRef: {
    chiefComplaint: string | null
    visitReason: string | null
    complaintHistory: string | null
  } | null
  // Referências do odontograma para facilitar o vínculo.
  odontogramRef: {
    currentEvents: Array<{
      toothNumber: string
      dentition: string
      kind: string
      code: string
      label: string
      surfaces: string[]
      status: string
    }>
  } | null
}

// ---------------------------------------------------------------------------
// Resposta de finalização
// ---------------------------------------------------------------------------

export interface FinalizeResponse {
  success: true
  finalized: boolean
  finalizedAt: string | null
  finalizedByName: string | null
  changes: Array<{
    field: string
    oldValue: string | null
    newValue: string | null
  }>
}

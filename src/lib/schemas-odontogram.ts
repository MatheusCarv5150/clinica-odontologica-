import { z } from "zod"
import { DENTITIONS, NUMBERING_SYSTEM_LABELS } from "@/lib/tooth-catalog"

// ===========================================================================
// Validação do ODONTOGRAMA (Parte 5).
//
// Usada pelo backend ANTES de qualquer escrita. O cliente nunca define:
// - o paciente (resolvido do atendimento);
// - o snapshot do procedimento (copiado do catálogo no servidor);
// - a data/hora de eventos históricos (associada ao atendimento atual).
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

// ---------------------------------------------------------------------------
// Condição
// ---------------------------------------------------------------------------

export const conditionEventSchema = z.object({
  kind: z.literal("condition"),
  // Código do catálogo de condições (ver odontogram-domain.ts).
  code: z.string().trim().min(1, "Condição é obrigatória").max(60),
  toothNumber: toothNumberSchema,
  dentition: dentitionSchema,
  surfaces: surfacesSchema,
  // Observação clínica do profissional sobre este registro.
  notes: optionalText(1000),
})

export type ConditionEventInput = z.infer<typeof conditionEventSchema>

// ---------------------------------------------------------------------------
// Procedimento
// ---------------------------------------------------------------------------

export const procedureEventSchema = z.object({
  kind: z.literal("procedure"),
  // Referência ao catálogo REAL de procedimentos (não duplicado).
  procedureId: z.string().trim().min(1, "Procedimento é obrigatório"),
  toothNumber: toothNumberSchema,
  dentition: dentitionSchema,
  surfaces: surfacesSchema,
  // PLANEJADO x REALIZADO. "performed" é o padrão quando o profissional
  // registra a execução; "planned" prepara o Plano de Tratamento.
  status: z.enum(["planned", "performed"]).default("performed"),
  notes: optionalText(1000),
})

export type ProcedureEventInput = z.infer<typeof procedureEventSchema>

// ---------------------------------------------------------------------------
// Registro no odontograma
// ---------------------------------------------------------------------------

// Um registro pode afetar VÁRIOS dentes (ex.: selante em 16, 26, 36, 46),
// desde que a condição/procedimento permita. O serviço valida cada dente.
export const registerOdontogramEventSchema = z
  .object({
    kind: z.enum(["condition", "procedure"]),
    code: z.string().trim().min(1).max(60).optional().nullable(),
    procedureId: z.string().trim().min(1).optional().nullable(),
    toothNumbers: z
      .array(toothNumberSchema)
      .min(1, "Selecione ao menos um dente.")
      .max(32, "Seleção de dentes inválida."),
    dentition: dentitionSchema,
    surfaces: surfacesSchema,
    status: z.enum(["planned", "performed"]).optional(),
    notes: optionalText(1000),
    // Profissional responsável pelo registro (rótulo informado).
    professionalName: optionalText(120),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "condition" && !value.code) {
      ctx.addIssue({
        code: "custom",
        path: ["code"],
        message: "Informe a condição.",
      })
    }
    if (value.kind === "procedure" && !value.procedureId) {
      ctx.addIssue({
        code: "custom",
        path: ["procedureId"],
        message: "Informe o procedimento.",
      })
    }
  })

export type RegisterOdontogramEventInput = z.infer<
  typeof registerOdontogramEventSchema
>

// ---------------------------------------------------------------------------
// Transição de status de um procedimento (planejado -> realizado/cancelado)
// ---------------------------------------------------------------------------

export const updateEventStatusSchema = z.object({
  status: z.enum(["performed", "cancelled"]),
  // Permite registrar a observação da execução/cancelamento.
  notes: optionalText(1000),
  professionalName: optionalText(120),
})

export type UpdateEventStatusInput = z.infer<typeof updateEventStatusSchema>

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export const odontogramQuerySchema = z.object({
  dentition: z
    .enum(DENTITIONS as [string, ...string[]])
    .optional()
    .default("permanent"),
  // "current" (padrão) mostra o estado atual; "history" carrega os eventos.
  view: z.enum(["current", "history"]).optional().default("current"),
  numbering: z
    .enum(Object.keys(NUMBERING_SYSTEM_LABELS) as [string, ...string[]])
    .optional()
    .default("fdi"),
})

export type OdontogramQuery = z.infer<typeof odontogramQuerySchema>

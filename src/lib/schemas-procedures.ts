import { z } from "zod"

// ===========================================================================
// Validação dos PROCEDIMENTOS DO ATENDIMENTO (Parte 7).
//
// Usada pelo backend ANTES de qualquer escrita. O cliente NUNCA define:
// - o paciente (resolvido do atendimento);
// - o snapshot do procedimento (copiado do catálogo no servidor);
// - o valor previsto quando o item veio da Agenda (herdado no servidor);
// - a data/hora da execução (gerada pelo servidor);
// - a relação com o odontograma (o serviço grava o evento e o id de volta).
//
// A REGRA DE ALTERAÇÃO DE VALOR (Procedure.allowPriceOverride) é validada no
// serviço — não confiamos apenas no frontend.
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
// Registrar / atualizar uma execução
// ---------------------------------------------------------------------------

export const registerProcedureExecutionSchema = z
  .object({
    // Referência ao catálogo REAL de procedimentos (não duplicado).
    procedureId: z.string().trim().min(1, "Procedimento é obrigatório"),
    // Origem: veio da Agenda ou adicionado durante o atendimento.
    origin: z.enum(["scheduled", "added_in_attendance"]).default("added_in_attendance"),
    // Item da Agenda de origem (obrigatório apenas quando a origem é "scheduled").
    scheduledProcedureId: z.string().trim().min(1).optional().nullable(),
    // Status desejado. O padrão de um registro novo vindo da Agenda é
    // "pending"; de um adicionado no atendimento é "performed".
    status: z
      .enum(["pending", "in_progress", "performed", "not_performed", "cancelled"])
      .optional(),
    // Motivo da não realização (código controlado no domínio).
    reasonCode: z
      .enum([
        "patient_not_authorized",
        "postponed",
        "needs_further_evaluation",
        "patient_unfit",
        "patient_absent",
        "other",
      ])
      .optional()
      .nullable(),
    reasonNote: optionalText(1000),
    // Dente e superfície (opcionais: há procedimentos sem dente).
    toothNumber: toothNumberSchema.optional().nullable(),
    dentition: dentitionSchema.optional().nullable(),
    surfaces: surfacesSchema,
    // Valor realizado (só aceito quando o procedimento permite alteração de
    // valor — validado no serviço).
    performedPrice: z
      .number()
      .min(0, "Valor não pode ser negativo.")
      .max(1_000_000, "Valor acima do limite permitido.")
      .optional()
      .nullable(),
    notes: optionalText(1000),
    professionalName: optionalText(120),
  })
  .superRefine((value, ctx) => {
    // Registro vindo da Agenda PRECISA referenciar o item original — é o que
    // garante a rastreabilidade previsto x realizado.
    if (value.origin === "scheduled" && !value.scheduledProcedureId) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduledProcedureId"],
        message: "Informe o procedimento da Agenda de origem.",
      })
    }
    // Não realizado exige motivo — a auditoria depende disso.
    if (value.status === "not_performed" && !value.reasonCode) {
      ctx.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Informe o motivo da não realização.",
      })
    }
    // Superfície exige dente.
    if (value.surfaces && value.surfaces.length > 0 && !value.toothNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["toothNumber"],
        message: "Informe o dente para registrar superfícies.",
      })
    }
  })

export type RegisterProcedureExecutionInput = z.infer<
  typeof registerProcedureExecutionSchema
>

// ---------------------------------------------------------------------------
// Atualizar status (marcar como realizado / não realizado / cancelado)
// ---------------------------------------------------------------------------

export const updateProcedureExecutionSchema = z
  .object({
    status: z.enum([
      "pending",
      "in_progress",
      "performed",
      "not_performed",
      "cancelled",
    ]),
    reasonCode: z
      .enum([
        "patient_not_authorized",
        "postponed",
        "needs_further_evaluation",
        "patient_unfit",
        "patient_absent",
        "other",
      ])
      .optional()
      .nullable(),
    reasonNote: optionalText(1000),
    // Dados que podem ser ajustados no momento da confirmação.
    toothNumber: toothNumberSchema.optional().nullable(),
    dentition: dentitionSchema.optional().nullable(),
    surfaces: surfacesSchema,
    performedPrice: z
      .number()
      .min(0, "Valor não pode ser negativo.")
      .max(1_000_000, "Valor acima do limite permitido.")
      .optional()
      .nullable(),
    notes: optionalText(1000),
    professionalName: optionalText(120),
  })
  .superRefine((value, ctx) => {
    if (value.status === "not_performed" && !value.reasonCode) {
      ctx.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Informe o motivo da não realização.",
      })
    }
  })

export type UpdateProcedureExecutionInput = z.infer<
  typeof updateProcedureExecutionSchema
>

// ---------------------------------------------------------------------------
// Consulta (filtros)
// ---------------------------------------------------------------------------

export const proceduresQuerySchema = z.object({
  status: z
    .enum([
      "all",
      "pending",
      "in_progress",
      "performed",
      "not_performed",
      "cancelled",
    ])
    .optional()
    .default("all"),
  origin: z.enum(["all", "scheduled", "added_in_attendance"]).optional().default("all"),
  q: z.string().trim().max(120).optional().default(""),
})

export type ProceduresQuery = z.infer<typeof proceduresQuerySchema>

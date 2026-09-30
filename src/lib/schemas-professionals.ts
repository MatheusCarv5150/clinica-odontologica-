import { z } from "zod"
import {
  COUNCIL_TYPES,
  validateCPF,
  normalizeCpf,
  normalizeName,
} from "@/lib/professionals-domain"

// ===========================================================================
// Validação do cadastro de USUÁRIO/PROFISSIONAL — módulo Configurações.
//
// ATENÇÃO: este schema é a camada de UX/contrato. A validação AUTORITATIVA
// vive em `professionals-service.ts` (`validateProfessionalPayload`), que é
// executada no backend independentemente do que o cliente enviar.
// ===========================================================================

export { validateCPF }

export const professionalSchema = z.object({
  fullName: z
    .string()
    .transform((value) => normalizeName(value))
    .refine((value) => value.length > 0, "O nome completo é obrigatório.")
    .refine(
      (value) => value.length >= 3,
      "Nome completo deve ter pelo menos 3 caracteres."
    ),
  birthDate: z
    .string()
    .refine(
      (value) => !!value && !isNaN(new Date(value).getTime()),
      "Data de nascimento inválida."
    )
    .refine(
      (value) => new Date(value) <= new Date(),
      "A data de nascimento não pode ser futura."
    ),
  cpf: z
    .string()
    .transform((value) => normalizeCpf(value))
    .refine((value) => value.length > 0, "O CPF é obrigatório.")
    .refine((value) => validateCPF(value), "CPF inválido."),
  councilType: z.enum(COUNCIL_TYPES, {
    message: "Tipo de conselho inválido.",
  }),
  councilNumber: z.string().trim().min(1, "O número do conselho é obrigatório."),
  councilState: z
    .string()
    .trim()
    .toUpperCase()
    .nullable()
    .optional()
    .refine(
      (value) => !value || /^[A-Z]{2}$/.test(value),
      "UF do conselho inválida."
    ),
  status: z.enum(["active", "inactive"]).default("active"),
})

export type ProfessionalInput = z.infer<typeof professionalSchema>

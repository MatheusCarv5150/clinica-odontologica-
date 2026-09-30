// ===========================================================================
// DOMÍNIO DE USUÁRIOS/PROFISSIONAIS — módulo Configurações.
// ===========================================================================
//
// Módulo ISOMÓRFICO: contém apenas regras puras (sem Prisma, sem acesso a
// banco), para ser usado tanto no backend (`professionals-service.ts`) quanto
// no frontend (formulários e listagens). Evita duplicar a validação de CPF ou
// a lista de conselhos em dois lugares.
//
// A AUTORIDADE da validação continua sendo o backend: o frontend usa estas
// funções apenas para UX (feedback imediato).

export const COUNCIL_TYPES = [
  "CRO",
  "CRM",
  "CRP",
  "CREFITO",
  "COREN",
  "CREF",
  "Outros",
] as const

export type CouncilType = (typeof COUNCIL_TYPES)[number]

export const BRAZILIAN_STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const

export type ProfessionalStatus = "active" | "inactive"

// ---------------------------------------------------------------------------
// CPF — validação real (dígitos verificadores)
// ---------------------------------------------------------------------------

/** Remove tudo que não é dígito. */
export function normalizeCpf(value: string): string {
  return (value ?? "").replace(/\D/g, "")
}

/**
 * Valida um CPF (com ou sem máscara).
 *
 * Regras:
 *  - precisa ter 11 dígitos;
 *  - sequências repetidas (000.000.000-00, 111.111.111-11, ...) são rejeitadas;
 *  - os dois dígitos verificadores são conferidos pelo módulo 11.
 */
export function validateCPF(value: string): boolean {
  const cpf = normalizeCpf(value)
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false

  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i)
  let digit = (sum * 10) % 11
  if (digit === 10) digit = 0
  if (digit !== Number(cpf[9])) return false

  sum = 0
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i)
  digit = (sum * 10) % 11
  if (digit === 10) digit = 0
  if (digit !== Number(cpf[10])) return false

  return true
}

// ---------------------------------------------------------------------------
// Normalização e formatação
// ---------------------------------------------------------------------------

/** Trim + colapso de espaços internos duplicados. */
export function normalizeName(value: string): string {
  return (value ?? "").trim().replace(/\s+/g, " ")
}

/** 12345678900 -> 123.456.789-00 */
export function formatCpf(value: string): string {
  const digits = normalizeCpf(value)
  if (digits.length !== 11) return value
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

/**
 * Monta o rótulo do conselho para exibição.
 * A UF entra SOMENTE quando informada: "CRO-PE 12345" ou "CRO 12345".
 */
export function formatCouncilLabel(
  councilType: string,
  councilNumber: string,
  councilState?: string | null
): string {
  const type = (councilType ?? "").trim()
  const number = (councilNumber ?? "").trim()
  const state = (councilState ?? "").trim().toUpperCase()
  if (!type) return number
  if (!number) return type
  return state ? `${type}-${state} ${number}` : `${type} ${number}`
}

export function statusLabel(status: string): string {
  return status === "inactive" ? "Inativo" : "Ativo"
}

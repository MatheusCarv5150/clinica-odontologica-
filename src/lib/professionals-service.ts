// ===========================================================================
// SERVIÇO DE USUÁRIOS / PROFISSIONAIS — módulo Configurações (Parte 1).
// ===========================================================================
//
// O QUE ESTE SERVIÇO É
//
// A base da IDENTIDADE PROFISSIONAL do OdontoCare. Ele gerencia o cadastro
// persistente de profissionais que podem executar e finalizar atendimentos.
//
// CONCEITO DE IDENTIDADE
//
//   ID            -> identidade relacional principal (FK nos módulos)
//   Nome/Conselho -> snapshot histórico gravado nos eventos
//   CPF           -> identificação civil única (NÃO é FK)
//
// Esta entidade (`Professional`) representa hoje tanto o "usuário do sistema"
// quanto o "perfil profissional", de forma unificada. No futuro, quando a
// autenticação existir, ela poderá ser separada em `User` + `ProfessionalProfile`
// sem quebrar os módulos: os eventos continuam referenciando o MESMO id.
//
// O QUE NÃO EXISTE AQUI (propositalmente)
//
//   - login, senha, sessão, JWT, RBAC, permissões.
//   A autenticação é uma etapa FUTURA; a estrutura já está preparada
//   (`id` estável + snapshot nos eventos) para receber `passwordHash`,
//   `email`, `roles` etc. sem remodelagem.
//
// REGRAS DE NEGÓCIO
//
//   - Nome: obrigatório, normalizado (trim + espaços duplicados).
//   - Nascimento: data real e não futura.
//   - CPF: validado (dígitos verificadores) e ÚNICO.
//   - Conselho: tipo (CRO/CRM/.../Outros) + número + UF opcional.
//   - Status: "active" | "inactive". NUNCA há exclusão física de um
//     profissional com histórico — apenas inativação.
//   - Profissional inativo não é oferecido para NOVOS atendimentos, mas
//     permanece no histórico, relatórios e vínculos antigos.

import { prisma } from "@/lib/prisma"
import type { ProfessionalInput } from "@/lib/schemas-professionals"
import {
  COUNCIL_TYPES,
  formatCouncilLabel,
  formatCpf,
  normalizeCpf,
  normalizeName,
  statusLabel,
  validateCPF,
  type ProfessionalStatus,
} from "@/lib/professionals-domain"

export type { ProfessionalStatus }

export type ProfessionalView = {
  id: string
  fullName: string
  birthDate: string
  cpf: string
  cpfFormatted: string
  councilType: string
  councilNumber: string
  councilState: string | null
  councilLabel: string
  status: ProfessionalStatus
  statusLabel: string
  createdAt: string
  updatedAt: string
}

export type ProfessionalError = {
  error: string
  code: string
  status: number
  field?: string
}

/**
 * Erro tipado do serviço de profissionais. Usado internamente para reutilizar
 * as regras de unicidade entre criação e edição sem duplicar mensagens.
 */
export class ProfessionalServiceError extends Error {
  code: string
  status: number
  field?: string

  constructor(message: string, code: string, status: number, field?: string) {
    super(message)
    this.name = "ProfessionalServiceError"
    this.code = code
    this.status = status
    this.field = field
  }
}

// Reexportado para quem consome o service sem importar o domínio separadamente.
export { formatCouncilLabel, formatCpf, validateCPF }

// ---------------------------------------------------------------------------
// Projeção para a camada de apresentação
// ---------------------------------------------------------------------------

function toView(row: {
  id: string
  fullName: string
  birthDate: Date
  cpf: string
  councilType: string
  councilNumber: string
  councilState: string | null
  status: string
  createdAt: Date
  updatedAt: Date
}): ProfessionalView {
  const status: ProfessionalStatus = row.status === "inactive" ? "inactive" : "active"
  return {
    id: row.id,
    fullName: row.fullName,
    birthDate: row.birthDate.toISOString(),
    cpf: row.cpf,
    cpfFormatted: formatCpf(row.cpf),
    councilType: row.councilType,
    councilNumber: row.councilNumber,
    councilState: row.councilState,
    councilLabel: formatCouncilLabel(row.councilType, row.councilNumber, row.councilState),
    status,
    statusLabel: statusLabel(status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Validação (autoritativa — o backend NUNCA confia no frontend)
// ---------------------------------------------------------------------------

export type ValidatedProfessionalPayload = {
  fullName: string
  birthDate: Date
  cpf: string
  councilType: string
  councilNumber: string
  councilState: string | null
  status: ProfessionalStatus
}

export function validateProfessionalPayload(
  input: Partial<ProfessionalInput> & { councilState?: string | null }
): ValidatedProfessionalPayload | ProfessionalError {
  const fullName = normalizeName(input.fullName ?? "")
  if (!fullName) {
    return {
      error: "O nome completo é obrigatório.",
      code: "NAME_REQUIRED",
      status: 422,
      field: "fullName",
    }
  }

  const birthRaw = input.birthDate
  if (!birthRaw) {
    return {
      error: "A data de nascimento é obrigatória.",
      code: "BIRTH_DATE_REQUIRED",
      status: 422,
      field: "birthDate",
    }
  }
  const birthDate = new Date(birthRaw)
  if (isNaN(birthDate.getTime())) {
    return {
      error: "Data de nascimento inválida.",
      code: "BIRTH_DATE_INVALID",
      status: 422,
      field: "birthDate",
    }
  }
  const today = new Date()
  if (birthDate.getTime() > today.getTime()) {
    return {
      error: "A data de nascimento não pode ser futura.",
      code: "BIRTH_DATE_FUTURE",
      status: 422,
      field: "birthDate",
    }
  }

  const cpf = normalizeCpf(input.cpf ?? "")
  if (!cpf) {
    return { error: "O CPF é obrigatório.", code: "CPF_REQUIRED", status: 422, field: "cpf" }
  }
  if (!validateCPF(cpf)) {
    return { error: "CPF inválido.", code: "CPF_INVALID", status: 422, field: "cpf" }
  }

  const councilType = (input.councilType ?? "").trim()
  if (!councilType) {
    return {
      error: "O conselho profissional é obrigatório.",
      code: "COUNCIL_TYPE_REQUIRED",
      status: 422,
      field: "councilType",
    }
  }
  if (!COUNCIL_TYPES.includes(councilType as (typeof COUNCIL_TYPES)[number])) {
    return {
      error: "Tipo de conselho inválido.",
      code: "COUNCIL_TYPE_INVALID",
      status: 422,
      field: "councilType",
    }
  }

  const councilNumber = (input.councilNumber ?? "").trim()
  if (!councilNumber) {
    return {
      error: "O número do conselho é obrigatório.",
      code: "COUNCIL_NUMBER_REQUIRED",
      status: 422,
      field: "councilNumber",
    }
  }

  const rawState = (input.councilState ?? "").trim().toUpperCase()
  const councilState = rawState.length === 0 ? null : rawState
  if (councilState && !/^[A-Z]{2}$/.test(councilState)) {
    return {
      error: "UF do conselho inválida.",
      code: "COUNCIL_STATE_INVALID",
      status: 422,
      field: "councilState",
    }
  }

  const status: ProfessionalStatus = input.status === "inactive" ? "inactive" : "active"

  return { fullName, birthDate, cpf, councilType, councilNumber, councilState, status }
}

export function isProfessionalError(value: unknown): value is ProfessionalError {
  return typeof value === "object" && value !== null && "error" in value && "code" in value
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export type ListProfessionalsParams = {
  search?: string
  status?: "all" | ProfessionalStatus
  councilType?: "all" | string
  page?: number
  pageSize?: number
}

export type ListProfessionalsResult = {
  items: ProfessionalView[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Listagem SERVER-SIDE com busca, filtros e paginação.
 * A busca cobre nome, CPF e conselho (tipo/número) — nunca carregamos todos
 * os profissionais para o frontend.
 */
export async function listProfessionals(
  params: ListProfessionalsParams = {}
): Promise<ListProfessionalsResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))

  const where: Record<string, unknown> = {}
  if (params.status && params.status !== "all") where.status = params.status
  if (params.councilType && params.councilType !== "all") {
    where.councilType = params.councilType
  }

  const search = (params.search ?? "").trim()
  if (search) {
    const digits = normalizeCpf(search)
    const or: Record<string, unknown>[] = [
      { fullName: { contains: search } },
      { councilNumber: { contains: search } },
      { councilType: { contains: search.toUpperCase() } },
    ]
    if (digits.length >= 3) or.push({ cpf: { contains: digits } })
    where.OR = or
  }

  const [total, rows] = await Promise.all([
    prisma.professional.count({ where }),
    prisma.professional.findMany({
      where,
      orderBy: [{ status: "asc" }, { fullName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return {
    items: rows.map(toView),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

export async function getProfessional(id: string): Promise<ProfessionalView | null> {
  const row = await prisma.professional.findUnique({ where: { id } })
  return row ? toView(row) : null
}

/**
 * SNAPSHOT de identidade para gravar no ATENDIMENTO no momento da ação.
 *
 * Este é o ponto de integração com o módulo de Atendimento: o profissional é
 * resolvido NO BACKEND a partir do id, e o snapshot (nome + conselho) é
 * congelado no registro do atendimento. Assim, uma edição cadastral futura
 * NÃO reescreve o histórico — o atendimento permanece fiel ao momento em que
 * foi encerrado.
 *
 * Retorna `null` quando o id não corresponde a um profissional cadastrado
 * (ex.: identidade textual legada), permitindo ao chamador decidir o fallback.
 */
export type ProfessionalSnapshot = {
  id: string
  fullName: string
  councilLabel: string | null
}

export async function resolveProfessionalSnapshot(
  id: string | null | undefined
): Promise<ProfessionalSnapshot | null> {
  if (!id) return null
  const row = await prisma.professional.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      councilType: true,
      councilNumber: true,
      councilState: true,
    },
  })
  if (!row) return null
  return {
    id: row.id,
    fullName: row.fullName,
    councilLabel:
      formatCouncilLabel(row.councilType, row.councilNumber, row.councilState) || null,
  }
}

/**
 * Profissionais ATIVOS para seleção em NOVOS atendimentos.
 * Inativos ficam de fora — mas continuam acessíveis no histórico via id.
 */
export async function listActiveProfessionals(): Promise<ProfessionalView[]> {
  const rows = await prisma.professional.findMany({
    where: { status: "active" },
    orderBy: { fullName: "asc" },
  })
  return rows.map(toView)
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

async function assertCpfAvailable(cpf: string, ignoreId?: string) {
  const existing = await prisma.professional.findUnique({ where: { cpf } })
  if (existing && existing.id !== ignoreId) {
    throw new ProfessionalServiceError(
      "Já existe um usuário/profissional cadastrado com este CPF.",
      "CPF_ALREADY_EXISTS",
      409,
      "cpf"
    )
  }
}

export async function createProfessional(
  input: Partial<ProfessionalInput> & { councilState?: string | null }
): Promise<ProfessionalView | ProfessionalError> {
  const validated = validateProfessionalPayload(input)
  if (isProfessionalError(validated)) return validated

  try {
    await assertCpfAvailable(validated.cpf)
  } catch (err) {
    if (err instanceof ProfessionalServiceError) {
      return { error: err.message, code: err.code, status: err.status, field: err.field }
    }
    throw err
  }

  const created = await prisma.professional.create({
    data: {
      fullName: validated.fullName,
      birthDate: validated.birthDate,
      cpf: validated.cpf,
      councilType: validated.councilType,
      councilNumber: validated.councilNumber,
      councilState: validated.councilState,
      status: validated.status,
    },
  })

  return toView(created)
}

export async function updateProfessional(
  id: string,
  input: Partial<ProfessionalInput> & { councilState?: string | null }
): Promise<ProfessionalView | ProfessionalError> {
  const current = await prisma.professional.findUnique({ where: { id } })
  if (!current) {
    return { error: "Profissional não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const validated = validateProfessionalPayload(input)
  if (isProfessionalError(validated)) return validated

  try {
    await assertCpfAvailable(validated.cpf, id)
  } catch (err) {
    if (err instanceof ProfessionalServiceError) {
      return { error: err.message, code: err.code, status: err.status, field: err.field }
    }
    throw err
  }

  // IMPORTANTE: alterar o cadastro NÃO altera os snapshots históricos já
  // gravados nos atendimentos (finishedByName/Council). O histórico permanece
  // fiel ao momento em que foi registrado; apenas o id continua sendo a ponte.
  const updated = await prisma.professional.update({
    where: { id },
    data: {
      fullName: validated.fullName,
      birthDate: validated.birthDate,
      cpf: validated.cpf,
      councilType: validated.councilType,
      councilNumber: validated.councilNumber,
      councilState: validated.councilState,
      status: validated.status,
    },
  })

  return toView(updated)
}

export async function setProfessionalStatus(
  id: string,
  status: ProfessionalStatus
): Promise<ProfessionalView | ProfessionalError> {
  const current = await prisma.professional.findUnique({ where: { id } })
  if (!current) {
    return { error: "Profissional não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const updated = await prisma.professional.update({
    where: { id },
    data: { status: status === "inactive" ? "inactive" : "active" },
  })

  return toView(updated)
}

/**
 * Exclusão física: permitida apenas quando o profissional NÃO possui nenhum
 * registro histórico vinculado. Caso contrário, a operação é recusada e o
 * caminho correto é a INATIVAÇÃO.
 */
export async function deleteProfessional(
  id: string
): Promise<{ success: true } | ProfessionalError> {
  const current = await prisma.professional.findUnique({ where: { id } })
  if (!current) {
    return { error: "Profissional não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const linkedAppointments = await prisma.appointment.count({
    where: { finishedById: id },
  })
  const linkedFinalizations = await prisma.appointmentFinalizationLog.count({
    where: { performedById: id },
  })

  if (linkedAppointments > 0 || linkedFinalizations > 0) {
    return {
      error:
        "Este profissional possui histórico vinculado e não pode ser excluído. Inative-o para removê-lo das novas ações.",
      code: "HAS_HISTORY",
      status: 409,
    }
  }

  await prisma.professional.delete({ where: { id } })
  return { success: true }
}

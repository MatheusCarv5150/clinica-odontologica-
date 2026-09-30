// ===========================================================================
// Domínio da EVOLUÇÃO CLÍNICA CRONOLÓGICA — módulo Atendimento (Parte 8).
// ===========================================================================
//
// O QUE ESTA PARTE É (e o que NÃO é):
//
//   Parte 6 — REGISTRO DO ATENDIMENTO: documenta o que aconteceu NAQUELA
//             consulta (queixa, achados, avaliação, conduta, evolução...).
//             É um FORMULÁRIO de entrada de dados.
//
//   Parte 8 — EVOLUÇÃO: é a LINHA DO TEMPO CLÍNICA LONGITUDINAL do paciente.
//             Não cria dados clínicos novos: apenas conecta, em ordem
//             cronológica, os registros que JÁ existem (atendimentos,
//             registros do atendimento, procedimentos e odontograma) para
//             que o profissional entenda a trajetória clínica do paciente.
//
// REGRA DE OURO (não violar):
//   - NÃO criar segunda fonte de verdade.
//   - NÃO duplicar pacientes, atendimentos, procedimentos nem dentes.
//   - NÃO criar tabela de evolução paralela: a timeline é uma PROJEÇÃO de
//     leitura sobre Appointment + AppointmentEvolution + procedimentos +
//     odontograma.
//
// Este módulo é PURO (sem acesso a banco): define tipos do contrato, a
// classificação dos itens da timeline e as regras de apresentação. Backend e
// frontend leem daqui para não divergir de rótulos nem de regras.
//
// ---------------------------------------------------------------------------
// FONTES REAIS DA TIMELINE
// ---------------------------------------------------------------------------
//   Appointment                       → o atendimento (data/hora, status)
//   AppointmentEvolution              → o registro clínico do atendimento
//   AppointmentProcedureExecution     → procedimentos executados (Parte 7)
//   AppointmentProcedure              → procedimentos previstos (Agenda)
//   AppointmentProcedureRecord        → procedimentos do registro (Parte 6)
//   OdontogramEvent                   → eventos clínicos por dente (Parte 5)
//   Anamnesis                         → queixa do atendimento (Parte 4)
//
// Nada além disso é inventado. Um atendimento sem conteúdo clínico NÃO gera
// evolução clínica (ver `classifyTimelineEntry`).

import { parseSurfaces, SURFACE_LABELS } from "@/lib/tooth-catalog"

// ---------------------------------------------------------------------------
// Classificação do item da timeline
// ---------------------------------------------------------------------------

// Cada item da timeline é um ATENDIMENTO visto pela ótica clínica. Ele é
// classificado de acordo com o que realmente aconteceu — nunca por inferência
// clínica automática:
//
//   current        → atendimento em andamento (destacado no topo)
//   draft          → registro clínico iniciado e NÃO finalizado (rascunho)
//   incomplete     → atendimento sem registro clínico, porém com procedimentos
//                    ou eventos clínicos (evolução parcial)
//   documented     → atendimento com registro clínico finalizado
//   cancelled      → atendimento cancelado (NÃO é evolução clínica)
//   no_show        → paciente não compareceu (NÃO gera evolução clínica)
//   scheduled      → atendimento futuro/agendado (NÃO é evolução; aparece
//                    apenas como referência, nunca como histórico clínico)
export type TimelineEntryKind =
  | "current"
  | "draft"
  | "incomplete"
  | "documented"
  | "cancelled"
  | "no_show"
  | "scheduled"

export interface TimelineKindMeta {
  label: string
  description: string
  // Classe visual do selo (mesma linguagem do prontuário).
  badge: string
  dot: string
  // Um item "clínico" contribui para a evolução clínica do paciente.
  // Cancelamentos e não comparecimentos NÃO são evolução clínica.
  clinical: boolean
}

export const TIMELINE_KIND_META: Record<TimelineEntryKind, TimelineKindMeta> = {
  current: {
    label: "Atendimento atual",
    description: "Atendimento em andamento neste momento.",
    badge: "bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
    clinical: true,
  },
  draft: {
    label: "Registro em andamento",
    description: "Registro clínico iniciado e ainda não finalizado (rascunho).",
    badge: "bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
    clinical: true,
  },
  incomplete: {
    label: "Registro clínico incompleto",
    description:
      "Atendimento com procedimentos/eventos registrados, mas sem registro clínico estruturado.",
    badge: "bg-orange-100 text-orange-800",
    dot: "bg-orange-500",
    clinical: true,
  },
  documented: {
    label: "Atendimento concluído",
    description: "Registro clínico finalizado.",
    badge: "bg-gray-100 text-gray-700",
    dot: "bg-gray-400",
    clinical: true,
  },
  cancelled: {
    label: "Cancelado",
    description: "Atendimento cancelado — não representa evolução clínica.",
    badge: "bg-red-100 text-red-800",
    dot: "bg-red-500",
    clinical: false,
  },
  no_show: {
    label: "Não compareceu",
    description: "Paciente não compareceu — não gera evolução clínica.",
    badge: "bg-orange-100 text-orange-800",
    dot: "bg-orange-500",
    clinical: false,
  },
  scheduled: {
    label: "Agendado",
    description: "Atendimento agendado, ainda sem registro clínico.",
    badge: "bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
    clinical: false,
  },
}

export function getTimelineKindMeta(kind: TimelineEntryKind): TimelineKindMeta {
  return TIMELINE_KIND_META[kind] ?? TIMELINE_KIND_META.documented
}

// ---------------------------------------------------------------------------
// Contrato com a API (GET /api/attendance/[id]/evolution-timeline)
// ---------------------------------------------------------------------------

export interface TimelineProcedure {
  id: string
  procedureId: string
  name: string
  code: string | null
  // "performed" | "not_performed" | "cancelled" | "pending" | "in_progress"
  status: string
  toothNumber: string | null
  dentition: string | null
  surfaces: string[]
  surfacesLabel: string
  notes: string | null
  professionalName: string | null
  // Valor efetivamente realizado (quando houver).
  performedPrice: number | null
  // Origem: Agenda ou adicionado durante o atendimento.
  origin: string
  // Id da execução (para abrir o atendimento completo já no procedimento).
  executionId: string | null
}

export interface TimelineToothEvent {
  id: string
  toothNumber: string
  dentition: string
  kind: string
  code: string
  label: string
  surfaces: string[]
  surfacesLabel: string
  status: string
}

export interface TimelineEntry {
  // ID do atendimento (fonte da verdade do item).
  id: string
  kind: TimelineEntryKind
  // Data do atendimento (UTC) — distinta da data de criação do registro.
  date: string
  time: string | null
  status: string
  isCurrent: boolean
  // Profissional responsável pelo registro clínico (quando informado).
  professional: { id: string; name: string } | null

  // --- Resumo clínico (curado, não é o atendimento inteiro) ---
  // Queixa registrada no atendimento (Anamnese/Parte 4 ou evolução/Parte 6).
  chiefComplaint: string | null
  // Avaliação/conduta resumidas para leitura rápida na timeline.
  evaluation: string | null
  conduct: string | null
  // Resumo da evolução clínica (texto do profissional responsável).
  evolutionSummary: string | null
  // Intercorrência registrada (indicador + descrição).
  hasIntercurrent: boolean
  intercurrentDescription: string | null

  // --- Conteúdo clínico vinculado (fontes reais) ---
  procedures: TimelineProcedure[]
  toothEvents: TimelineToothEvent[]
  // Dentes envolvidos (deduplicados, ordenados) — derivados dos procedimentos
  // e eventos do odontograma. NÃO é um novo cadastro de dentes.
  teeth: Array<{ toothNumber: string; surfaces: string[] }>

  // --- Controle de registro ---
  recordId: string | null
  recordFinalized: boolean
  // Total de campos clínicos preenchidos (para identificar registro incompleto).
  filledSections: number
  // Data/hora de criação e de atualização do RECURSO (auditoria).
  // Distinta da data do atendimento.
  recordCreatedAt: string | null
  recordUpdatedAt: string | null

  // O atendimento completo pode ser aberto (somente leitura se antigo).
  canOpenFull: boolean
}

export interface TimelineGroup {
  // Chave de agrupamento (YYYY-MM-DD).
  dateKey: string
  // Rótulo de exibição: "10 de setembro de 2026".
  label: string
  entries: TimelineEntry[]
}

export interface TimelineFiltersMeta {
  // Profissionais distintos que aparecem na evolução do paciente.
  professionals: Array<{ id: string; name: string }>
  // Procedimentos distintos realmente registrados (não o catálogo inteiro).
  procedures: Array<{ id: string; name: string }>
  // Dentes que aparecem na evolução do paciente.
  teeth: string[]
  // Períodos disponíveis para o filtro rápido.
  periods: Array<{ value: TimelinePeriod; label: string }>
}

export type TimelinePeriod =
  | "all"
  | "30d"
  | "6m"
  | "1y"
  | "custom"

export const TIMELINE_PERIODS: Array<{
  value: TimelinePeriod
  label: string
}> = [
  { value: "all", label: "Todo o período" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "6m", label: "Últimos 6 meses" },
  { value: "1y", label: "Último ano" },
  { value: "custom", label: "Período personalizado" },
]

export interface TimelineResponse {
  patient: {
    id: string
    fullName: string
  }
  // Atendimento atual (quando o atendimento aberto é do próprio paciente).
  current: TimelineEntry | null
  // Linha do tempo clínica (mais recente primeiro), já agrupada por dia.
  groups: TimelineGroup[]
  // Lista plana dos itens da página atual (facilita contagens e testes).
  items: TimelineEntry[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasMore: boolean
  }
  summary: {
    totalAttendance: number
    documented: number
    incomplete: number
    drafts: number
    cancelled: number
    noShow: number
    lastClinicalVisit: string | null
    teethTreated: number
  }
  filters: TimelineFiltersMeta
}

// ---------------------------------------------------------------------------
// Regras de classificação (puras — testáveis sem banco)
// ---------------------------------------------------------------------------

export interface ClassificationInput {
  status: string
  hasFinalizedRecord: boolean
  hasRecord: boolean
  hasClinicalContent: boolean
  isCurrent: boolean
}

// Classifica um atendimento para a timeline. Regras explícitas:
// 1. Em andamento → "current" (destacado no topo, separado do histórico).
// 2. Cancelado / não compareceu → NÃO é evolução clínica.
// 3. Registro finalizado → "documented".
// 4. Registro iniciado e não finalizado → "draft" (rascunho identificado).
// 5. Sem registro clínico, mas com procedimentos/eventos → "incomplete".
// 6. Agendado/futuro → apenas referência, não é evolução.
export function classifyTimelineEntry(
  input: ClassificationInput
): TimelineEntryKind | null {
  if (input.isCurrent) return "current"

  if (input.status === "cancelled") return "cancelled"
  if (input.status === "no_show") return "no_show"

  if (input.hasFinalizedRecord) return "documented"
  if (input.hasRecord) return "draft"
  if (input.hasClinicalContent) return "incomplete"

  // Atendimento sem nenhum conteúdo clínico e ainda não realizado não é
  // evolução clínica; entra apenas como referência de agenda.
  if (input.status === "completed" || input.status === "in_progress") {
    return "incomplete"
  }
  return "scheduled"
}

// Um item é exibido na timeline clínica quando é evolução de fato. Itens
// não clínicos (cancelado, não compareceu, agendado) aparecem apenas quando
// explicitamente pedidos por filtro, nunca misturados como evolução.
export function isClinicalEntry(kind: TimelineEntryKind): boolean {
  return getTimelineKindMeta(kind).clinical
}

// ---------------------------------------------------------------------------
// Agrupamento por data
// ---------------------------------------------------------------------------

// Rótulo por extenso de um dia: "10 de setembro de 2026".
export function formatTimelineDayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return dateKey
  return date.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

// Abreviações de mês em pt-BR. Não usamos `toLocaleDateString` com
// month:"short" porque o runtime produz "de set. de" em algumas versões —
// o rótulo do card precisa ser previsível ("10 SET 2026").
const MONTH_ABBREVIATIONS = [
  "JAN",
  "FEV",
  "MAR",
  "ABR",
  "MAI",
  "JUN",
  "JUL",
  "AGO",
  "SET",
  "OUT",
  "NOV",
  "DEZ",
]

// Rótulo curto do card: "10 SET 2026".
export function formatTimelineCardDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return "—"
  const day = String(d.getUTCDate()).padStart(2, "0")
  const month = MONTH_ABBREVIATIONS[d.getUTCMonth()]
  return `${day} ${month} ${d.getUTCFullYear()}`
}

// "15:45" a partir de um ISO ou de "HH:MM".
export function formatTimelineTime(time: string | null): string | null {
  if (!time) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(time)
  if (match) return `${match[1].padStart(2, "0")}:${match[2]}`
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Data/hora de REGISTRO (auditoria), sempre distinta da data do atendimento.
export function formatTimelineAuditStamp(
  isoTimestamp: string | null
): string | null {
  if (!isoTimestamp) return null
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ---------------------------------------------------------------------------
// Superfícies e dentes
// ---------------------------------------------------------------------------

// "M,O" → "Mesial / Oclusal". Reutiliza o catálogo de superfícies (Parte 5):
// não há outra tabela de superfícies no sistema.
export function formatSurfaceList(csv: string | null | undefined): string {
  const surfaces = parseSurfaces(csv)
  if (surfaces.length === 0) return ""
  return surfaces.map((s) => SURFACE_LABELS[s]).join(" / ")
}

// Une dentes de procedimentos e eventos do odontograma, deduplicando por
// número e combinando as superfícies conhecidas. Os dentes continuam sendo a
// estrutura do odontograma — aqui só agregamos para exibição no card.
export function collectTeeth(
  procedures: Array<{ toothNumber: string | null; surfaces: string[] }>,
  events: Array<{ toothNumber: string; surfaces: string[] }>
): Array<{ toothNumber: string; surfaces: string[] }> {
  const map = new Map<string, Set<string>>()

  for (const proc of procedures) {
    if (!proc.toothNumber) continue
    const set = map.get(proc.toothNumber) ?? new Set<string>()
    proc.surfaces.forEach((s) => set.add(s))
    map.set(proc.toothNumber, set)
  }
  for (const event of events) {
    const set = map.get(event.toothNumber) ?? new Set<string>()
    event.surfaces.forEach((s) => set.add(s))
    map.set(event.toothNumber, set)
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR", { numeric: true }))
    .map(([toothNumber, surfaces]) => ({
      toothNumber,
      // Mantém a ordem clínica canônica (M, D, O, V, L).
      surfaces: ["M", "D", "O", "V", "L"].filter((s) => surfaces.has(s)),
    }))
}

// ---------------------------------------------------------------------------
// Resumo inteligente do card
// ---------------------------------------------------------------------------

// Resumo curto da evolução clínica exibido no card. O detalhamento completo
// fica em "Ver atendimento completo" — o card nunca mostra texto inteiro.
export function summarizeEvolutionText(
  text: string | null,
  maxLength = 180
): { text: string; truncated: boolean } | null {
  if (!text) return null
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return null
  if (normalized.length <= maxLength) {
    return { text: normalized, truncated: false }
  }
  const slice = normalized.slice(0, maxLength)
  const lastSpace = slice.lastIndexOf(" ")
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice
  return { text: `${cut}…`, truncated: true }
}

// ---------------------------------------------------------------------------
// Filtros e busca (executados no BACKEND)
// ---------------------------------------------------------------------------

export interface TimelineQuery {
  period: TimelinePeriod
  from?: string
  to?: string
  professional?: string
  procedure?: string
  tooth?: string
  query?: string
  // Inclui itens não clínicos (cancelado, não compareceu, agendado).
  includeNonClinical: boolean
  sort: "desc" | "asc"
  page: number
  pageSize: number
}

export function parseTimelineQuery(
  searchParams: URLSearchParams
): TimelineQuery {
  const periodParam = (searchParams.get("period") || "all").trim()
  const period: TimelinePeriod = (
    ["all", "30d", "6m", "1y", "custom"] as const
  ).includes(periodParam as TimelinePeriod)
    ? (periodParam as TimelinePeriod)
    : "all"

  const pageSize = Math.min(
    50,
    Math.max(1, parseInt(searchParams.get("pageSize") || "10", 10) || 10)
  )

  return {
    period,
    from: (searchParams.get("from") || "").trim() || undefined,
    to: (searchParams.get("to") || "").trim() || undefined,
    professional: (searchParams.get("professional") || "").trim() || undefined,
    procedure: (searchParams.get("procedure") || "").trim() || undefined,
    tooth: (searchParams.get("tooth") || "").trim() || undefined,
    query: (searchParams.get("q") || "").trim() || undefined,
    includeNonClinical: searchParams.get("includeNonClinical") === "1",
    sort: searchParams.get("sort") === "asc" ? "asc" : "desc",
    page: Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1),
    pageSize,
  }
}

// Converte o período nomeado em intervalo de datas (UTC, meia-noite).
// Mantém a regra em um só lugar para que frontend e backend não divirjam.
export function resolvePeriodRange(
  period: TimelinePeriod,
  now: Date = new Date()
): { from?: Date; to?: Date } {
  if (period === "all" || period === "custom") return {}

  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
  const from = new Date(to)

  if (period === "30d") from.setUTCDate(from.getUTCDate() - 30)
  else if (period === "6m") from.setUTCMonth(from.getUTCMonth() - 6)
  else if (period === "1y") from.setUTCFullYear(from.getUTCFullYear() - 1)

  return { from, to }
}

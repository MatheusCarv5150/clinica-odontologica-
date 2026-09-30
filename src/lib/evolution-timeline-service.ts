// ===========================================================================
// Serviço da EVOLUÇÃO CLÍNICA CRONOLÓGICA — módulo Atendimento (Parte 8).
// ===========================================================================
//
// Este serviço é SOMENTE LEITURA. Ele NÃO cria tabelas, NÃO grava registros
// clínicos e NÃO mantém estado. Sua única responsabilidade é PROJETAR a linha
// do tempo clínica do paciente a partir dos registros que JÁ EXISTEM.
//
// Fontes (todas já implementadas nas partes anteriores):
//   - Appointment                     (o atendimento — data/hora/status)
//   - AppointmentEvolution            (registro clínico — Parte 6)
//   - AppointmentProcedureExecution   (procedimentos executados — Parte 7)
//   - AppointmentProcedure            (procedimentos previstos — Agenda)
//   - AppointmentProcedureRecord      (procedimentos do registro — Parte 6)
//   - OdontogramEvent                 (eventos clínicos por dente — Parte 5)
//   - Anamnesis                       (queixa do atendimento — Parte 4)
//
// PRINCÍPIOS DE SEGURANÇA (LGPD / isolamento):
//   - O paciente NUNCA é recebido do cliente: é resolvido no servidor a partir
//     do atendimento informado. Não há como ler a evolução de outro paciente
//     alterando IDs na URL.
//
// PRINCÍPIOS DE PERFORMANCE:
//   - Paginação por ATENDIMENTO (não por evento): a timeline nunca carrega o
//     prontuário inteiro.
//   - Filtros que dependem de conteúdo (procedimento/dente) e a busca textual
//     são resolvidos no BANCO (via `some`/`contains`), não no navegador.
//   - Uma consulta paginada + uma consulta de metadados de filtro. Sem N+1.

import { prisma } from "@/lib/prisma"
import { normalizeTime } from "@/lib/date-utils"
import { normalizeSurfaces } from "@/lib/tooth-catalog"
import {
  type TimelineEntry,
  type TimelineEntryKind,
  type TimelineProcedure,
  type TimelineQuery,
  type TimelineResponse,
  type TimelineToothEvent,
  type TimelineGroup,
  collectTeeth,
  formatSurfaceList,
  formatTimelineDayLabel,
  resolvePeriodRange,
  classifyTimelineEntry,
} from "@/lib/evolution-timeline"

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

// Status de atendimento que representam uma consulta já realizada (ou em
// realização). "scheduled"/"awaiting_*" são agenda, não evolução.
const PERFORMED_STATUSES = ["completed", "in_progress"]

// Divide um DateTime em chave de dia (UTC) e horário "HH:MM".
// A data do atendimento é persistida em UTC à meia-noite; normalizamos em UTC
// para não deslocar o dia conforme o fuso do servidor.
function splitDate(date: Date): { dateKey: string; iso: string } {
  const iso = date.toISOString().split("T")[0]
  return { dateKey: iso, iso: date.toISOString() }
}

function toIsoOrNull(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null
}

// Conta quantas seções clínicas do registro estão preenchidas. Serve para
// identificar um registro incompleto sem inferir nada: é uma contagem objetiva.
function countFilledSections(record: {
  chiefComplaint: string | null
  clinicalFindings: string | null
  evaluation: string | null
  conduct: string | null
  evolution: string | null
  guidance: string | null
  observations: string | null
}): number {
  return [
    record.chiefComplaint,
    record.clinicalFindings,
    record.evaluation,
    record.conduct,
    record.evolution,
    record.guidance,
    record.observations,
  ].filter((value) => !!value?.trim()).length
}

// ---------------------------------------------------------------------------
// Montagem de uma entrada da timeline a partir de um atendimento carregado
// ---------------------------------------------------------------------------

type AppointmentRow = Awaited<ReturnType<typeof loadAppointments>>[number]

function buildEntry(
  row: AppointmentRow,
  currentId: string | null
): TimelineEntry {
  const isCurrent = row.id === currentId

  // --- Procedimentos REALIZADOS (fonte: execuções da Parte 7) ---
  // Um procedimento apenas agendado NÃO é evolução clínica: só entra o que foi
  // efetivamente executado (performed / in_progress) ou explicitamente
  // registrado no atendimento.
  const performedExecutions = row.procedureExecutions.filter((execution) =>
    ["performed", "in_progress"].includes(execution.status)
  )

  const procedures: TimelineProcedure[] = performedExecutions.map((execution) => ({
    id: execution.id,
    procedureId: execution.procedureId,
    name: execution.procedureNameSnapshot,
    code: execution.procedureCodeSnapshot,
    status: execution.status,
    toothNumber: execution.toothNumber,
    dentition: execution.dentition,
    surfaces: execution.surfaces ? execution.surfaces.split(",").filter(Boolean) : [],
    surfacesLabel: formatSurfaceList(execution.surfaces),
    notes: execution.notes,
    professionalName: execution.professionalName,
    performedPrice: execution.performedPrice,
    origin: execution.origin,
    executionId: execution.id,
  }))

  // Procedimentos registrados no REGISTRO CLÍNICO (Parte 6) que NÃO tenham
  // execução correspondente na Parte 7 são incorporados sem duplicar: a
  // assinatura (nome + dente + superfícies) evita repetir o mesmo item.
  const record = row.evolutionRecord
  if (record) {
    for (const item of record.procedureRecords) {
      if (item.status === "cancelled") continue
      const surfacesCsv = normalizeSurfaces(item.surfaces.split(","))
      const duplicate = procedures.some(
        (p) =>
          p.name === item.procedureNameSnapshot &&
          p.toothNumber === item.toothNumber &&
          normalizeSurfaces(p.surfaces) === surfacesCsv
      )
      if (duplicate) continue

      procedures.push({
        id: item.id,
        procedureId: item.procedureId,
        name: item.procedureNameSnapshot,
        code: null,
        status: item.status,
        toothNumber: item.toothNumber,
        dentition: item.dentition,
        surfaces: surfacesCsv ? surfacesCsv.split(",") : [],
        surfacesLabel: formatSurfaceList(surfacesCsv),
        notes: item.notes,
        professionalName: item.professionalName,
        performedPrice: null,
        origin: "record",
        executionId: null,
      })
    }
  }

  // --- Eventos clínicos do ODONTOGRAMA (fonte: Parte 5) ---
  const toothEvents: TimelineToothEvent[] = row.odontogramEvents.map((event) => ({
    id: event.id,
    toothNumber: event.toothNumber,
    dentition: event.dentition,
    kind: event.kind,
    code: event.code,
    label: event.labelSnapshot,
    surfaces: event.surfaces ? event.surfaces.split(",").filter(Boolean) : [],
    surfacesLabel: formatSurfaceList(event.surfaces),
    status: event.status,
  }))

  const teeth = collectTeeth(procedures, toothEvents)

  // --- Classificação ---
  const filledSections = record ? countFilledSections(record) : 0
  const hasClinicalContent =
    procedures.length > 0 || toothEvents.length > 0 || filledSections > 0

  const kind = classifyTimelineEntry({
    status: row.status,
    hasFinalizedRecord: !!record?.finalized,
    hasRecord: !!record,
    hasClinicalContent,
    isCurrent,
  }) as TimelineEntryKind

  // Queixa: prioriza o registro clínico (Parte 6) e usa a anamnese (Parte 4)
  // como complemento — nunca inventa texto.
  const chiefComplaint =
    record?.chiefComplaint?.trim() ||
    row.anamnesis?.chiefComplaint?.trim() ||
    null

  const professionalName =
    record?.finalizedByName?.trim() ||
    record?.createdByName?.trim() ||
    procedures.find((p) => p.professionalName)?.professionalName ||
    null

  return {
    id: row.id,
    kind,
    date: splitDate(row.appointmentDate).iso,
    time: normalizeTime(row.appointmentTime),
    status: row.status,
    isCurrent,
    professional: professionalName
      ? { id: professionalName, name: professionalName }
      : null,
    chiefComplaint,
    evaluation: record?.evaluation?.trim() || null,
    conduct: record?.conduct?.trim() || null,
    evolutionSummary: record?.evolution?.trim() || null,
    hasIntercurrent: !!record?.intercurrentHas,
    intercurrentDescription: record?.intercurrentDesc?.trim() || null,
    procedures,
    toothEvents,
    teeth,
    recordId: record?.id ?? null,
    recordFinalized: !!record?.finalized,
    filledSections,
    recordCreatedAt: toIsoOrNull(record?.createdAt),
    recordUpdatedAt: toIsoOrNull(record?.updatedAt),
    canOpenFull: true,
  }
}

// ---------------------------------------------------------------------------
// Select padrão: uma única forma de carregar o atendimento com tudo o que a
// timeline precisa. Reutilizado pela listagem e pelos metadados de filtro.
// ---------------------------------------------------------------------------

function appointmentSelect() {
  return {
    id: true,
    appointmentDate: true,
    appointmentTime: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    evolutionRecord: {
      select: {
        id: true,
        chiefComplaint: true,
        clinicalFindings: true,
        evaluation: true,
        conduct: true,
        evolution: true,
        guidance: true,
        intercurrentHas: true,
        intercurrentDesc: true,
        observations: true,
        finalized: true,
        finalizedAt: true,
        finalizedByName: true,
        createdByName: true,
        createdAt: true,
        updatedAt: true,
        procedureRecords: {
          select: {
            id: true,
            procedureId: true,
            procedureNameSnapshot: true,
            toothNumber: true,
            dentition: true,
            surfaces: true,
            status: true,
            notes: true,
            professionalName: true,
          },
        },
      },
    },
    anamnesis: {
      select: { chiefComplaint: true },
    },
    procedureExecutions: {
      select: {
        id: true,
        procedureId: true,
        procedureNameSnapshot: true,
        procedureCodeSnapshot: true,
        origin: true,
        status: true,
        toothNumber: true,
        dentition: true,
        surfaces: true,
        performedPrice: true,
        notes: true,
        professionalName: true,
      },
    },
    odontogramEvents: {
      select: {
        id: true,
        toothNumber: true,
        dentition: true,
        kind: true,
        code: true,
        labelSnapshot: true,
        surfaces: true,
        status: true,
      },
    },
  } as const
}

function loadAppointments(args: {
  where: Record<string, unknown>
  orderBy: Array<{ [key: string]: "asc" | "desc" }>
  skip: number
  take: number
}) {
  return prisma.appointment.findMany({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: args.where as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orderBy: args.orderBy as any,
    skip: args.skip,
    take: args.take,
    select: appointmentSelect(),
  })
}

// ---------------------------------------------------------------------------
// Filtros → cláusulas do banco (executados no BACKEND, nunca no navegador)
// ---------------------------------------------------------------------------

function buildWhere(
  patientId: string,
  query: TimelineQuery,
  currentAppointmentId: string
): Record<string, unknown> {
  const where: Record<string, unknown> = { patientId }

  // O atendimento atual nunca é listado no histórico: ele é devolvido em bloco
  // próprio (`current`) e não deve aparecer duplicado na linha do tempo.
  where.id = { not: currentAppointmentId }

  // --- Período ---
  // Períodos nomeados (30d/6m/1y) são resolvidos no servidor pela mesma regra
  // do domínio; o período personalizado usa as datas informadas.
  const dateRange: Record<string, Date> = {}
  const preset = resolvePeriodRange(query.period)
  const fromValue = query.period === "custom" ? query.from : preset.from?.toISOString().split("T")[0]
  const toValue = query.period === "custom" ? query.to : preset.to?.toISOString().split("T")[0]

  if (fromValue) {
    const from = new Date(`${fromValue}T00:00:00.000Z`)
    if (!Number.isNaN(from.getTime())) dateRange.gte = from
  }
  if (toValue) {
    const to = new Date(`${toValue}T23:59:59.999Z`)
    if (!Number.isNaN(to.getTime())) dateRange.lte = to
  }
  if (Object.keys(dateRange).length > 0) {
    where.appointmentDate = dateRange
  }

  // --- Não clínicos ---
  // Por padrão a timeline mostra apenas evolução clínica real. Cancelamentos
  // e não comparecimentos NÃO são evolução e só aparecem sob demanda.
  if (!query.includeNonClinical) {
    where.status = { in: PERFORMED_STATUSES }
  }

  // --- Filtro por procedimento (executado OU registrado no atendimento) ---
  if (query.procedure) {
    where.OR = [
      {
        procedureExecutions: {
          some: {
            procedureId: query.procedure,
            status: { in: ["performed", "in_progress"] },
          },
        },
      },
      {
        evolutionRecord: {
          is: {
            procedureRecords: { some: { procedureId: query.procedure } },
          },
        },
      },
    ]
  }

  // --- Filtro por dente (procedimento executado OU evento do odontograma) ---
  if (query.tooth) {
    const toothClauses = [
      {
        procedureExecutions: {
          some: {
            toothNumber: query.tooth,
            status: { in: ["performed", "in_progress"] },
          },
        },
      },
      {
        evolutionRecord: {
          is: {
            procedureRecords: { some: { toothNumber: query.tooth } },
          },
        },
      },
      { odontogramEvents: { some: { toothNumber: query.tooth } } },
    ]
    // Combina com um filtro de procedimento já existente (AND das condições).
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: toothClauses }]
  }

  // --- Filtro por profissional (rótulo textual — não há cadastro de usuários) ---
  if (query.professional) {
    const professionalClauses = [
      { evolutionRecord: { is: { createdByName: query.professional } } },
      { evolutionRecord: { is: { finalizedByName: query.professional } } },
      { procedureExecutions: { some: { professionalName: query.professional } } },
    ]
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      { OR: professionalClauses },
    ]
  }

  // --- Busca textual (queixa, achados, avaliação, conduta, evolução) ---
  if (query.query) {
    const text = query.query
    const searchClauses = [
      {
        evolutionRecord: {
          is: {
            OR: [
              { chiefComplaint: { contains: text } },
              { clinicalFindings: { contains: text } },
              { evaluation: { contains: text } },
              { conduct: { contains: text } },
              { evolution: { contains: text } },
              { observations: { contains: text } },
            ],
          },
        },
      },
      { anamnesis: { is: { chiefComplaint: { contains: text } } } },
      {
        procedureExecutions: {
          some: { procedureNameSnapshot: { contains: text } },
        },
      },
      { odontogramEvents: { some: { labelSnapshot: { contains: text } } } },
      { odontogramEvents: { some: { toothNumber: { contains: text } } } },
    ]
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      { OR: searchClauses },
    ]
  }

  return where
}

// ---------------------------------------------------------------------------
// Leitura principal
// ---------------------------------------------------------------------------

export async function getEvolutionTimeline(
  attendanceId: string,
  query: TimelineQuery
): Promise<TimelineResponse | null> {
  // 1) Resolver o paciente a partir do atendimento (fonte confiável).
  const current = await prisma.appointment.findUnique({
    where: { id: attendanceId },
    select: {
      id: true,
      patientId: true,
      patient: { select: { id: true, fullName: true } },
    },
  })

  if (!current) return null

  const where = buildWhere(current.patientId, query, current.id)
  const orderBy: Array<{ [key: string]: "asc" | "desc" }> =
    query.sort === "asc"
      ? [
          { appointmentDate: "asc" },
          { appointmentTime: "asc" },
          { createdAt: "asc" },
        ]
      : [
          { appointmentDate: "desc" },
          { appointmentTime: "desc" },
          { createdAt: "desc" },
        ]

  const [total, rows] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.appointment.count({ where: where as any }),
    loadAppointments({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ])

  const items = rows.map((row) => buildEntry(row, null))

  // 2) Atendimento ATUAL: carregado separadamente para ser destacado no topo,
  //    sempre pertencente ao mesmo paciente (resolvido no servidor).
  const currentRow = await prisma.appointment.findUnique({
    where: { id: current.id },
    select: appointmentSelect(),
  })
  const currentEntry = currentRow
    ? buildEntry(currentRow, current.id)
    : null

  // 3) Resumo e metadados de filtro (consultas leves e agregadas).
  const [summary, filters] = await Promise.all([
    loadSummary(current.patientId, current.id),
    loadFilterMeta(current.patientId),
  ])

  const groups = groupByDay(items)
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))

  return {
    patient: { id: current.patient.id, fullName: current.patient.fullName },
    current: currentEntry,
    groups,
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages,
      hasMore: query.page * query.pageSize < total,
    },
    summary,
    filters,
  }
}

// ---------------------------------------------------------------------------
// Agrupamento por dia (mantém a ordem recebida do banco)
// ---------------------------------------------------------------------------

function groupByDay(items: TimelineEntry[]): TimelineGroup[] {
  const groups: TimelineGroup[] = []
  let currentGroup: TimelineGroup | null = null

  for (const item of items) {
    const dateKey = item.date.split("T")[0]
    if (!currentGroup || currentGroup.dateKey !== dateKey) {
      currentGroup = {
        dateKey,
        label: formatTimelineDayLabel(dateKey),
        entries: [],
      }
      groups.push(currentGroup)
    }
    currentGroup.entries.push(item)
  }

  return groups
}

// ---------------------------------------------------------------------------
// Resumo do paciente (contagens agregadas — sem trazer registros)
// ---------------------------------------------------------------------------

async function loadSummary(patientId: string, currentAppointmentId: string) {
  const base = { patientId, id: { not: currentAppointmentId } }

  const [
    totalAttendance,
    documented,
    drafts,
    cancelled,
    noShow,
    lastClinical,
    teethRows,
  ] = await Promise.all([
    prisma.appointment.count({
      where: { ...base, status: { in: PERFORMED_STATUSES } },
    }),
    prisma.appointment.count({
      where: {
        ...base,
        evolutionRecord: { is: { finalized: true } },
      },
    }),
    prisma.appointment.count({
      where: {
        ...base,
        evolutionRecord: { is: { finalized: false } },
      },
    }),
    prisma.appointment.count({ where: { ...base, status: "cancelled" } }),
    prisma.appointment.count({ where: { ...base, status: "no_show" } }),
    prisma.appointment.findFirst({
      where: {
        ...base,
        status: "completed",
        evolutionRecord: { isNot: null },
      },
      orderBy: [{ appointmentDate: "desc" }, { appointmentTime: "desc" }],
      select: { appointmentDate: true },
    }),
    // Dentes tratados: distintos entre executados e eventos do odontograma.
    prisma.appointmentProcedureExecution.findMany({
      where: {
        patientId,
        status: { in: ["performed", "in_progress"] },
        toothNumber: { not: null },
        appointmentId: { not: currentAppointmentId },
      },
      select: { toothNumber: true },
      distinct: ["toothNumber"],
    }),
  ])

  const incomplete = Math.max(0, totalAttendance - documented - drafts)

  return {
    totalAttendance,
    documented,
    incomplete,
    drafts,
    cancelled,
    noShow,
    lastClinicalVisit:
      lastClinical?.appointmentDate.toISOString().split("T")[0] ?? null,
    teethTreated: teethRows.length,
  }
}

// ---------------------------------------------------------------------------
// Metadados dos filtros (apenas o que o paciente possui — não o catálogo todo)
// ---------------------------------------------------------------------------

async function loadFilterMeta(patientId: string) {
  const [executions, events] = await Promise.all([
    prisma.appointmentProcedureExecution.findMany({
      where: {
        patientId,
        status: { in: ["performed", "in_progress"] },
      },
      select: {
        procedureId: true,
        procedureNameSnapshot: true,
        professionalName: true,
        toothNumber: true,
      },
    }),
    prisma.odontogramEvent.findMany({
      where: { patientId },
      select: { toothNumber: true },
      distinct: ["toothNumber"],
    }),
  ])

  const procedureMap = new Map<string, string>()
  const professionalSet = new Set<string>()
  const toothSet = new Set<string>()

  for (const execution of executions) {
    procedureMap.set(execution.procedureId, execution.procedureNameSnapshot)
    if (execution.professionalName?.trim()) {
      professionalSet.add(execution.professionalName.trim())
    }
    if (execution.toothNumber) toothSet.add(execution.toothNumber)
  }
  for (const event of events) {
    toothSet.add(event.toothNumber)
  }

  return {
    professionals: [...professionalSet]
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((name) => ({ id: name, name })),
    procedures: [...procedureMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    teeth: [...toothSet].sort((a, b) =>
      a.localeCompare(b, "pt-BR", { numeric: true })
    ),
    periods: [
      { value: "all" as const, label: "Todo o período" },
      { value: "30d" as const, label: "Últimos 30 dias" },
      { value: "6m" as const, label: "Últimos 6 meses" },
      { value: "1y" as const, label: "Último ano" },
      { value: "custom" as const, label: "Período personalizado" },
    ],
  }
}

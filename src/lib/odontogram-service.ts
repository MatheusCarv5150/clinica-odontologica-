import { prisma } from "@/lib/prisma"
import {
  HEALTHY_CODE,
  canApplyToSelection,
  getCondition,
  projectToothStatus,
  resolveCariesForEvent,
  validateConditionApplication,
} from "@/lib/odontogram-domain"
import {
  type Dentition,
  type ToothDefinition,
  type ToothSurface,
  describeTooth,
  getToothDefinition,
  listTeeth,
  normalizeSurfaces,
  parseSurfaces,
} from "@/lib/tooth-catalog"
import type { RegisterOdontogramEventInput } from "@/lib/schemas-odontogram"

// ===========================================================================
// Serviço do ODONTOGRAMA (Parte 5).
//
// Responsabilidades:
// - Resolver o paciente SEMPRE a partir do atendimento (nunca do cliente).
// - Manter o HISTÓRICO (OdontogramEvent) append-only: nada é sobrescrito.
// - Recalcular a PROJEÇÃO do estado atual (ToothState) após cada escrita.
// - Separar condição de procedimento e planejado de realizado.
// - Reutilizar o catálogo REAL de procedimentos, com snapshot histórico.
// ===========================================================================

// ---------------------------------------------------------------------------
// Tipos do contrato com o frontend
// ---------------------------------------------------------------------------

export interface ToothStateView {
  number: string
  dentition: Dentition
  type: string
  arch: string
  quadrant: number
  description: string
  // Estado atual (derivado dos eventos de condição ativos).
  status: string
  conditionCodes: string[]
  hasHistory: boolean
  lastEventAt: string | null
}

export interface OdontogramEventView {
  id: string
  toothNumber: string
  dentition: string
  kind: "condition" | "procedure"
  code: string
  label: string
  surfaces: ToothSurface[]
  status: string
  procedureId: string | null
  procedureCode: string | null
  procedurePrice: number | null
  notes: string | null
  professionalName: string | null
  appointmentId: string
  attendanceCode: string
  occurredAt: string
}

export interface OdontogramResponse {
  patient: { id: string; fullName: string }
  attendance: { id: string; code: string; status: string; isOpen: boolean }
  dentition: Dentition
  teeth: ToothStateView[]
  // Eventos do atendimento atual, por dente (para diferenciar o que foi
  // registrado hoje do histórico anterior).
  currentEvents: OdontogramEventView[]
  // Dentes que possuem tratamento PLANEJADO no plano de tratamento (Parte 10.1)
  // e ainda não concluído. É apenas uma INDICAÇÃO VISUAL: o estado clínico do
  // dente NÃO é alterado por um planejamento (PLANEJADO ≠ REALIZADO).
  plannedTeeth: string[]
  summary: {
    totalTeeth: number
    withFindings: number
    healthy: number
    absent: number
  }
}

export interface ToothDetailResponse {
  patient: { id: string; fullName: string }
  tooth: ToothStateView
  // Condições ATIVAS (a situação atual).
  activeConditions: Array<{
    code: string
    name: string
    category: string
    surfaces: ToothSurface[]
  }>
  // Linha do tempo daquele dente (somente leitura).
  timeline: OdontogramEventView[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Resolve o atendimento + paciente. Toda operação parte daqui.
export async function resolveAttendance(attendanceId: string) {
  return prisma.appointment.findUnique({
    where: { id: attendanceId },
    select: {
      id: true,
      patientId: true,
      status: true,
      patient: { select: { id: true, fullName: true } },
    },
  })
}

function buildCode(id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
  return compact.slice(-6).padStart(6, "0")
}

function toEventView(event: {
  id: string
  toothNumber: string
  dentition: string
  kind: string
  code: string
  labelSnapshot: string
  surfaces: string
  status: string
  procedureId: string | null
  procedureCodeSnapshot: string | null
  procedurePriceSnapshot: number | null
  notes: string | null
  professionalName: string | null
  appointmentId: string
  occurredAt: Date
}): OdontogramEventView {
  return {
    id: event.id,
    toothNumber: event.toothNumber,
    dentition: event.dentition,
    kind: event.kind === "procedure" ? "procedure" : "condition",
    code: event.code,
    label: event.labelSnapshot,
    surfaces: parseSurfaces(event.surfaces),
    status: event.status,
    procedureId: event.procedureId,
    procedureCode: event.procedureCodeSnapshot,
    procedurePrice: event.procedurePriceSnapshot,
    notes: event.notes,
    professionalName: event.professionalName,
    appointmentId: event.appointmentId,
    attendanceCode: buildCode(event.appointmentId),
    occurredAt: event.occurredAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Projeção do estado atual
// ---------------------------------------------------------------------------

const TOOTH_STATE_SELECT = {
  toothNumber: true,
  dentition: true,
  status: true,
  conditionCodes: true,
  lastEventAt: true,
} as const

// Recalcula o estado ATUAL de UM dente a partir dos eventos clínicos.
//
// A projeção considera:
// - CONDIÇÕES ativas (cárie, restauração registrada como condição, ...);
// - PROCEDIMENTOS REALIZADOS que produzem um estado clínico (uma restauração
//   executada deixa o dente restaurado), derivado da categoria do catálogo.
//
// O histórico nunca é alterado por esta função — ela apenas DERIVA o estado.
export async function recalculateToothState(
  patientId: string,
  toothNumber: string,
  dentition: Dentition
): Promise<void> {
  const [conditionEvents, performedProcedures] = await Promise.all([
    prisma.odontogramEvent.findMany({
      where: {
        patientId,
        toothNumber,
        dentition,
        kind: "condition",
        status: "active",
      },
      select: { code: true, surfaces: true, status: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }),
    // Procedimentos realizados com o rastro da condição que produzem
    // (procedureCodeSnapshot guarda o código; a categoria vem do catálogo).
    prisma.odontogramEvent.findMany({
      where: {
        patientId,
        toothNumber,
        dentition,
        kind: "procedure",
        status: "performed",
      },
      select: {
        code: true,
        surfaces: true,
        occurredAt: true,
        procedure: { select: { category: true } },
      },
      orderBy: { occurredAt: "asc" },
    }),
  ])

  // Procedimento realizado -> condição resultante. Sem procedimento
  // vinculado ao catálogo (registro legado/sem FK), não altera o estado.
  const derivedFromProcedures = performedProcedures
    .filter((procedure) => procedure.procedure !== null)
    .map((procedure) => ({
      code: conditionCodeForProcedure({
        code: procedure.code,
        category: procedure.procedure?.category ?? "",
      }),
      surfaces: procedure.surfaces,
      status: "active",
      occurredAt: procedure.occurredAt,
    }))
    // Apenas categorias que de fato produzem condição clínica entram na
    // projeção; o restante é ignorado (evita "condição fantasma").
    .filter((derived) => getCondition(derived.code) !== null)

  // Ordem cronológica: condições resolvidas primeiro, depois condições ativas
  // e procedimentos realizados na sequência real dos fatos.
  const projectionInput = [
    ...conditionEvents.map((e) => ({
      code: e.code,
      surfaces: e.surfaces,
      status: e.status,
      occurredAt: e.occurredAt,
    })),
    ...derivedFromProcedures,
  ].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  )

  const { status, conditionCodes } = projectToothStatus(projectionInput)

  const lastEvent = await prisma.odontogramEvent.findFirst({
    where: { patientId, toothNumber, dentition },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  })

  // Projeção "vazia" não precisa existir na tabela.
  if (conditionCodes.length === 0 && !lastEvent) {
    await prisma.toothState.deleteMany({
      where: { patientId, toothNumber, dentition },
    })
    return
  }

  await prisma.toothState.upsert({
    where: {
      patientId_toothNumber_dentition: { patientId, toothNumber, dentition },
    },
    create: {
      patientId,
      toothNumber,
      dentition,
      status,
      conditionCodes: conditionCodes.join(","),
      lastEventAt: lastEvent?.occurredAt ?? null,
    },
    update: {
      status,
      conditionCodes: conditionCodes.join(","),
      lastEventAt: lastEvent?.occurredAt ?? null,
    },
  })
}

// ---------------------------------------------------------------------------
// Leitura — odontograma
// ---------------------------------------------------------------------------

function buildToothStateView(
  tooth: ToothDefinition,
  state: {
    status: string
    conditionCodes: string
    lastEventAt: Date | null
  } | null,
  currentEventCount: number
): ToothStateView {
  return {
    number: tooth.number,
    dentition: tooth.dentition,
    type: tooth.type,
    arch: tooth.arch,
    quadrant: tooth.quadrant,
    description: describeTooth(tooth.number),
    status: state?.status ?? HEALTHY_CODE,
    conditionCodes: state?.conditionCodes
      ? state.conditionCodes.split(",").filter(Boolean)
      : [],
    hasHistory: (state?.lastEventAt ?? null) !== null || currentEventCount > 0,
    lastEventAt: state?.lastEventAt ? state.lastEventAt.toISOString() : null,
  }
}

// Carrega o odontograma do paciente dono do atendimento, para a dentição
// escolhida. Os dentes SEM registro aparecem como saudáveis (empty state).
export async function getOdontogram(
  attendanceId: string,
  dentition: Dentition
): Promise<OdontogramResponse | null> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) return null

  const [states, events, plannedItems] = await Promise.all([
    prisma.toothState.findMany({
      where: { patientId: appointment.patientId, dentition },
      select: TOOTH_STATE_SELECT,
    }),
    // Eventos de TODAS as dentições para o resumo, mas separamos os do
    // atendimento atual para destacar o que foi registrado hoje.
    prisma.odontogramEvent.findMany({
      where: { patientId: appointment.patientId, dentition },
      orderBy: { occurredAt: "desc" },
      select: {
        id: true,
        toothNumber: true,
        dentition: true,
        kind: true,
        code: true,
        labelSnapshot: true,
        surfaces: true,
        status: true,
        procedureId: true,
        procedureCodeSnapshot: true,
        procedurePriceSnapshot: true,
        notes: true,
        professionalName: true,
        appointmentId: true,
        occurredAt: true,
      },
    }),
    // Tratamento PLANEJADO (Parte 10.1): apenas os dentes com item de plano
    // aberto. Nenhum dado clínico é lido/alterado aqui.
    prisma.treatmentPlanItem.findMany({
      where: {
        patientId: appointment.patientId,
        dentition,
        toothNumber: { not: null },
        status: { notIn: ["completed", "cancelled", "not_done"] },
      },
      select: { toothNumber: true },
    }),
  ])

  const stateByTooth = new Map(states.map((s) => [s.toothNumber, s]))

  const currentEventCounts = new Map<string, number>()
  const currentEvents: OdontogramEventView[] = []
  for (const event of events) {
    if (event.appointmentId === appointment.id) {
      currentEventCounts.set(
        event.toothNumber,
        (currentEventCounts.get(event.toothNumber) ?? 0) + 1
      )
      currentEvents.push(toEventView(event))
    }
  }

  const teeth = listTeeth(dentition).map((tooth) => {
    const state = stateByTooth.get(tooth.number)
    return buildToothStateView(
      tooth,
      state
        ? {
            status: state.status,
            conditionCodes: state.conditionCodes,
            lastEventAt: state.lastEventAt,
          }
        : null,
      currentEventCounts.get(tooth.number) ?? 0
    )
  })

  const withFindings = teeth.filter(
    (t) => t.status !== HEALTHY_CODE || t.conditionCodes.length > 0
  ).length
  const absent = teeth.filter(
    (t) => t.status === "absent" || t.status === "extracted"
  ).length

  // Dentes com tratamento planejado (aberto) — indicação visual apenas.
  const plannedTeeth = Array.from(
    new Set(
      plannedItems
        .map((item) => item.toothNumber)
        .filter((tooth): tooth is string => !!tooth)
    )
  ).sort()

  return {
    patient: {
      id: appointment.patient.id,
      fullName: appointment.patient.fullName,
    },
    attendance: {
      id: appointment.id,
      code: buildCode(appointment.id),
      status: appointment.status,
      // Registros só são permitidos em atendimento iniciado.
      isOpen: appointment.status === "in_progress",
    },
    dentition,
    teeth,
    currentEvents,
    plannedTeeth,
    summary: {
      totalTeeth: teeth.length,
      withFindings,
      healthy: teeth.length - withFindings,
      absent,
    },
  }
}

// ---------------------------------------------------------------------------
// Leitura — detalhe de um dente (situação atual + timeline)
// ---------------------------------------------------------------------------

export async function getToothDetail(
  attendanceId: string,
  toothNumber: string
): Promise<ToothDetailResponse | null> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) return null

  const tooth = getToothDefinition(toothNumber)
  if (!tooth) return null

  const [state, events] = await Promise.all([
    prisma.toothState.findUnique({
      where: {
        patientId_toothNumber_dentition: {
          patientId: appointment.patientId,
          toothNumber: tooth.number,
          dentition: tooth.dentition,
        },
      },
      select: TOOTH_STATE_SELECT,
    }),
    prisma.odontogramEvent.findMany({
      where: {
        patientId: appointment.patientId,
        toothNumber: tooth.number,
        dentition: tooth.dentition,
      },
      orderBy: { occurredAt: "desc" },
      select: {
        id: true,
        toothNumber: true,
        dentition: true,
        kind: true,
        code: true,
        labelSnapshot: true,
        surfaces: true,
        status: true,
        procedureId: true,
        procedureCodeSnapshot: true,
        procedurePriceSnapshot: true,
        notes: true,
        professionalName: true,
        appointmentId: true,
        occurredAt: true,
      },
    }),
  ])

  // Condições ativas, agrupadas por código, com as superfícies somadas.
  const activeByCode = new Map<
    string,
    { code: string; name: string; category: string; surfaces: Set<ToothSurface> }
  >()

  for (const event of events) {
    if (event.kind !== "condition" || event.status !== "active") continue
    const condition = getCondition(event.code)
    if (!condition || condition.code === HEALTHY_CODE) continue
    const entry = activeByCode.get(condition.code) ?? {
      code: condition.code,
      name: condition.name,
      category: condition.category,
      surfaces: new Set<ToothSurface>(),
    }
    for (const surface of parseSurfaces(event.surfaces)) {
      entry.surfaces.add(surface)
    }
    activeByCode.set(condition.code, entry)
  }

  return {
    patient: {
      id: appointment.patient.id,
      fullName: appointment.patient.fullName,
    },
    tooth: buildToothStateView(
      tooth,
      state
        ? {
            status: state.status,
            conditionCodes: state.conditionCodes,
            lastEventAt: state.lastEventAt,
          }
        : null,
      0
    ),
    activeConditions: Array.from(activeByCode.values()).map((entry) => ({
      code: entry.code,
      name: entry.name,
      category: entry.category,
      surfaces: Array.from(entry.surfaces),
    })),
    timeline: events.map(toEventView),
  }
}

// ---------------------------------------------------------------------------
// Escrita — registro de evento
// ---------------------------------------------------------------------------

export interface RegisterResult {
  created: number
  toothNumbers: string[]
  // Eventos de procedimento planejados criados (gancho do Plano de Tratamento).
  planned: boolean
}

export type RegisterError =
  | { error: string; code: string; status: number }

// Registra uma CONDIÇÃO ou um PROCEDIMENTO em um ou mais dentes.
//
// Regras aplicadas no servidor (autoridade final):
// - O atendimento precisa existir e estar em andamento.
// - O dente precisa existir no FDI e pertencer à dentição informada.
// - A condição precisa existir no catálogo e ser aplicável ao dente.
// - Procedimento precisa existir no catálogo REAL e estar ativo.
// - Snapshot de nome/código/preço é copiado AGORA (preserva o histórico).
export async function registerEvent(
  attendanceId: string,
  input: RegisterOdontogramEventInput
): Promise<RegisterResult | RegisterError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  if (appointment.status !== "in_progress") {
    return {
      error:
        appointment.status === "completed"
          ? "Este atendimento já foi finalizado. O odontograma relacionado está fechado e não pode ser alterado retroativamente por este atendimento."
          : "Registros no odontograma só podem ser feitos durante o atendimento. Inicie o atendimento para continuar.",
      code: "ATTENDANCE_NOT_OPEN",
      status: 409,
    }
  }

  // Validação dos dentes contra a dentição informada.
  const teeth: ToothDefinition[] = []
  for (const rawNumber of input.toothNumbers) {
    const tooth = getToothDefinition(rawNumber)
    if (!tooth) {
      return {
        error: `Dente "${rawNumber}" não é um número FDI válido.`,
        code: "INVALID_TOOTH",
        status: 400,
      }
    }
    if (tooth.dentition !== input.dentition) {
      return {
        error: `O dente ${rawNumber} não pertence à dentição selecionada.`,
        code: "WRONG_DENTITION",
        status: 400,
      }
    }
    teeth.push(tooth)
  }

  const uniqueTeeth = Array.from(new Map(teeth.map((t) => [t.number, t])).values())
  const surfaces = normalizeSurfaces(input.surfaces)

  if (input.kind === "condition") {
    return registerCondition(
      appointment.patientId,
      appointment.id,
      input,
      uniqueTeeth,
      surfaces
    )
  }

  return registerProcedure(
    appointment.patientId,
    appointment.id,
    input,
    uniqueTeeth,
    surfaces
  )
}

async function registerCondition(
  patientId: string,
  appointmentId: string,
  input: RegisterOdontogramEventInput,
  teeth: ToothDefinition[],
  surfaces: string
): Promise<RegisterResult | RegisterError> {
  const code = input.code!
  const condition = getCondition(code)
  if (!condition) {
    return {
      error: `Condição "${code}" não existe no catálogo.`,
      code: "UNKNOWN_CONDITION",
      status: 400,
    }
  }

  // "Saudável" é o estado neutro — não é registrado como evento.
  if (condition.code === HEALTHY_CODE) {
    return {
      error:
        'A condição "Saudável" representa a ausência de registros e não é gravada como evento.',
      code: "HEALTHY_NOT_RECORDABLE",
      status: 400,
    }
  }

  // Compatibilidade de seleção múltipla.
  const selectionCheck = canApplyToSelection(
    condition.code,
    teeth.map((t) => ({
      number: t.number,
      dentition: t.dentition,
      type: t.type,
    }))
  )
  if (!selectionCheck.ok) {
    return { error: selectionCheck.message, code: selectionCheck.code, status: 400 }
  }

  // Validação individual (superfície obrigatória, etc.).
  for (const tooth of teeth) {
    const result = validateConditionApplication({
      code: condition.code,
      dentition: tooth.dentition,
      toothType: tooth.type,
      surfaces: surfaces ? (surfaces.split(",") as ToothSurface[]) : [],
    })
    if (!result.ok) {
      return { error: result.message, code: result.code, status: 400 }
    }
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    for (const tooth of teeth) {
      // Regra clínica: registrar a restauração (ou outro tratamento
      // resolutivo) RESOLVE a cárie existente nas mesmas superfícies. O
      // evento de cárie NÃO é apagado — apenas deixa de estar ativo.
      await resolveActiveCaries(
        tx,
        patientId,
        tooth.number,
        tooth.dentition,
        { code: condition.code, surfaces }
      )

      await tx.odontogramEvent.create({
        data: {
          patientId,
          appointmentId,
          toothNumber: tooth.number,
          dentition: tooth.dentition,
          kind: "condition",
          code: condition.code,
          labelSnapshot: condition.name,
          surfaces,
          status: "active",
          notes: input.notes,
          professionalName: input.professionalName,
          occurredAt: now,
        },
        select: { id: true },
      })
    }
  })

  for (const tooth of teeth) {
    await recalculateToothState(patientId, tooth.number, tooth.dentition)
  }

  return { created: teeth.length, toothNumbers: teeth.map((t) => t.number), planned: false }
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

// Traduz a CATEGORIA do procedimento do catálogo real para a CONDIÇÃO
// clínica que ele produz. É o que permite que "Restauração em resina"
// (procedimento) resolva a cárie (condição) — sem confundir as duas
// entidades, que continuam distintas.
//
// Procedimentos sem efeito direto sobre a cárie retornam o próprio código,
// que não está em CARIES_RESOLVING_CODES e portanto não resolve nada.
function conditionCodeForProcedure(procedure: { code: string; category: string }): string {
  const category = procedure.category?.toLowerCase() ?? ""
  if (category.includes("restaura")) return "restoration"
  if (category.includes("endodontia")) return "endodontic"
  if (category.includes("prótese") || category.includes("protese")) return "prosthesis"
  if (category.includes("cirurgia")) return "extracted"
  if (category.includes("estética") || category.includes("estetica")) return "veneer"
  if (category.includes("prevenção") || category.includes("prevencao")) return "sealant"
  return procedure.code
}

// Marca como "resolved" as cáries ativas alcançadas por um tratamento.
// O registro permanece no histórico (nunca é apagado).
async function resolveActiveCaries(
  tx: Tx,
  patientId: string,
  toothNumber: string,
  dentition: Dentition,
  newEvent: { code: string; surfaces: string }
): Promise<void> {
  const activeCaries = await tx.odontogramEvent.findMany({
    where: {
      patientId,
      toothNumber,
      dentition,
      kind: "condition",
      code: "caries",
      status: "active",
    },
    select: { id: true, surfaces: true },
  })

  if (activeCaries.length === 0) return

  const toResolve = resolveCariesForEvent(newEvent, activeCaries)
  if (toResolve.length === 0) return

  await tx.odontogramEvent.updateMany({
    where: { id: { in: toResolve } },
    data: { status: "resolved" },
  })
}

async function registerProcedure(
  patientId: string,
  appointmentId: string,
  input: RegisterOdontogramEventInput,
  teeth: ToothDefinition[],
  surfaces: string
): Promise<RegisterResult | RegisterError> {
  // Catálogo REAL de procedimentos — nunca duplicado.
  const procedure = await prisma.procedure.findUnique({
    where: { id: input.procedureId! },
    select: {
      id: true,
      name: true,
      code: true,
      category: true,
      defaultPrice: true,
      active: true,
    },
  })

  if (!procedure) {
    return {
      error: "Procedimento não encontrado no catálogo.",
      code: "UNKNOWN_PROCEDURE",
      status: 404,
    }
  }

  if (!procedure.active) {
    return {
      error: `O procedimento "${procedure.name}" está inativo e não pode ser registrado.`,
      code: "INACTIVE_PROCEDURE",
      status: 400,
    }
  }

  const status = input.status === "planned" ? "planned" : "performed"
  const now = new Date()

  await prisma.$transaction(async (tx) => {
    for (const tooth of teeth) {
      // Apenas o procedimento REALIZADO altera o estado clínico. Um
      // procedimento PLANEJADO não resolve nada — ele ainda não aconteceu.
      if (status === "performed") {
        await resolveActiveCaries(tx, patientId, tooth.number, tooth.dentition, {
          code: conditionCodeForProcedure(procedure),
          surfaces,
        })
      }

      await tx.odontogramEvent.create({
        data: {
          patientId,
          appointmentId,
          toothNumber: tooth.number,
          dentition: tooth.dentition,
          kind: "procedure",
          code: procedure.code,
          labelSnapshot: procedure.name,
          surfaces,
          status,
          procedureId: procedure.id,
          // Snapshot: preserva o histórico mesmo se o catálogo mudar.
          procedureCodeSnapshot: procedure.code,
          procedurePriceSnapshot: procedure.defaultPrice,
          notes: input.notes,
          professionalName: input.professionalName,
          occurredAt: now,
        },
        select: { id: true },
      })
    }
  })

  // Procedimento NÃO altera o estado atual do dente (a condição clínica é
  // outra entidade), mas atualiza a marca de último evento.
  for (const tooth of teeth) {
    await recalculateToothState(patientId, tooth.number, tooth.dentition)
  }

  return {
    created: teeth.length,
    toothNumbers: teeth.map((t) => t.number),
    planned: status === "planned",
  }
}

// ---------------------------------------------------------------------------
// Escrita — transição de status de um procedimento
// ---------------------------------------------------------------------------

// Marca um procedimento PLANEJADO como REALIZADO (ou cancelado).
// Nunca sobrescreve o registro: cria um NOVO evento "performed" vinculado ao
// mesmo plano e encerra o planejado, preservando a história completa.
export async function updateProcedureEventStatus(
  attendanceId: string,
  eventId: string,
  input: { status: "performed" | "cancelled"; notes: string | null; professionalName: string | null }
): Promise<
  { ok: true; eventId: string } | RegisterError
> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  if (appointment.status !== "in_progress") {
    return {
      error:
        appointment.status === "completed"
          ? "Este atendimento já foi finalizado. O odontograma relacionado está fechado e não pode ser alterado retroativamente por este atendimento."
          : "O atendimento precisa estar em andamento para registrar alterações.",
      code: "ATTENDANCE_NOT_OPEN",
      status: 409,
    }
  }

  const event = await prisma.odontogramEvent.findFirst({
    where: {
      id: eventId,
      // Isolamento: o evento precisa pertencer ao paciente do atendimento.
      patientId: appointment.patientId,
      kind: "procedure",
    },
    select: {
      id: true,
      patientId: true,
      toothNumber: true,
      dentition: true,
      code: true,
      labelSnapshot: true,
      surfaces: true,
      status: true,
      procedureId: true,
      procedureCodeSnapshot: true,
      procedurePriceSnapshot: true,
    },
  })

  if (!event) {
    return {
      error: "Procedimento não encontrado para este paciente.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  if (event.status !== "planned") {
    return {
      error: "Somente procedimentos planejados podem mudar de status.",
      code: "INVALID_TRANSITION",
      status: 409,
    }
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    // Encerra o planejamento (mantendo o registro para o histórico).
    await tx.odontogramEvent.update({
      where: { id: event.id },
      data: {
        status: input.status === "performed" ? "performed" : "cancelled",
      },
    })

    // Realizado gera um evento CLÍNICO novo: o planejado continua registrado.
    if (input.status === "performed") {
      await tx.odontogramEvent.create({
        data: {
          patientId: event.patientId,
          appointmentId: appointment.id,
          toothNumber: event.toothNumber,
          dentition: event.dentition,
          kind: "procedure",
          code: event.code,
          labelSnapshot: event.labelSnapshot,
          surfaces: event.surfaces,
          status: "performed",
          procedureId: event.procedureId,
          procedureCodeSnapshot: event.procedureCodeSnapshot,
          procedurePriceSnapshot: event.procedurePriceSnapshot,
          notes: input.notes,
          professionalName: input.professionalName,
          occurredAt: now,
        },
        select: { id: true },
      })
    }
  })

  await recalculateToothState(
    event.patientId,
    event.toothNumber,
    event.dentition as Dentition
  )

  return { ok: true, eventId: event.id }
}

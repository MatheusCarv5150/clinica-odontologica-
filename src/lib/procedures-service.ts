import { prisma } from "@/lib/prisma"
import {
  type ProcedureComparisonResult,
  type ProcedureExecutionStatus,
  type ProcedureOrigin,
  compareScheduledVsPerformed,
  compareValues,
  findDuplicate,
  getProcedureReasonLabel,
  isPerformed,
  normalizeProcedureSurfaces,
  procedureSurfacesToList,
} from "@/lib/procedure-execution-domain"
import type {
  RegisterProcedureExecutionInput,
  UpdateProcedureExecutionInput,
} from "@/lib/schemas-procedures"
import { getToothDefinition, type Dentition, type ToothSurface } from "@/lib/tooth-catalog"
import { registerEvent } from "@/lib/odontogram-service"

// ===========================================================================
// Serviço dos PROCEDIMENTOS DO ATENDIMENTO (Parte 7).
//
// RESPONSABILIDADES
// - Responder "o que estava previsto e o que foi realmente feito".
// - Resolver o paciente SEMPRE a partir do atendimento (isolamento/LGPD).
// - Preservar a AGENDA: o item agendado nunca é removido nem sobrescrito.
// - Manter a diferença explícita entre valor previsto e valor realizado.
// - Reutilizar o catálogo REAL de procedimentos (com snapshot histórico).
// - Integrar com o ODONTOGRAMA: um procedimento realizado que envolva dente
//   gera o evento clínico correspondente (nada de segunda estrutura de dentes).
// - Registrar auditoria das alterações relevantes.
//
// NÃO FAZ (por definição da Parte 7):
// - não cria pagamentos (o Financeiro consolidará a partir do valor realizado);
// - não altera o preço do catálogo;
// - não copia a anamnese nem a evolução.
// ===========================================================================

// ---------------------------------------------------------------------------
// Tipos do contrato com o frontend
// ---------------------------------------------------------------------------

export interface ScheduledProcedureView {
  id: string
  procedureId: string
  procedureNameSnapshot: string
  unitPrice: number
  quantity: number
  totalPrice: number
  // Execução registrada para este item (quando o profissional já atuou).
  executionId: string | null
  origin: ProcedureOrigin
}

export interface ProcedureExecutionView {
  id: string
  procedureId: string
  procedureNameSnapshot: string
  procedureCodeSnapshot: string | null
  origin: ProcedureOrigin
  scheduledProcedureId: string | null
  status: ProcedureExecutionStatus
  reasonCode: string | null
  reasonLabel: string | null
  reasonNote: string | null
  toothNumber: string | null
  dentition: string | null
  surfaces: string[]
  catalogPriceSnapshot: number | null
  expectedPrice: number | null
  performedPrice: number | null
  // Comparação derivada (previsto x realizado).
  comparison: ProcedureComparisonResult
  valueDifference: number | null
  valueDiffers: boolean
  notes: string | null
  professionalName: string | null
  odontogramEventId: string | null
  performedAt: string | null
  createdAt: string
}

export interface ProceduresResponse {
  appointment: {
    id: string
    code: string
    date: string
    time: string | null
    status: string
    isOpen: boolean
  }
  patient: { id: string; fullName: string; cpf: string }
  professional: { id: string; name: string } | null
  // Itens que vieram da Agenda (o previsto).
  scheduled: ScheduledProcedureView[]
  // Execuções registradas (realizado / não realizado / adicionado / cancelado).
  executions: ProcedureExecutionView[]
  summary: {
    scheduledCount: number
    performedCount: number
    notPerformedCount: number
    pendingCount: number
    addedCount: number
    expectedTotal: number
    performedTotal: number
    differenceTotal: number
    hasValueDifference: boolean
  }
  catalog: {
    // Metadados de apresentação (status, motivos) para a UI não recriar listas.
    reasons: Array<{ code: string; label: string }>
  }
}

export type ServiceError = { error: string; code: string; status: number }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCode(id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
  return compact.slice(-6).padStart(6, "0")
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

// Resolve o atendimento + paciente. Toda operação parte daqui.
async function resolveAttendance(attendanceId: string) {
  return prisma.appointment.findUnique({
    where: { id: attendanceId },
    select: {
      id: true,
      patientId: true,
      appointmentDate: true,
      appointmentTime: true,
      status: true,
      patient: { select: { id: true, fullName: true, cpf: true } },
    },
  })
}

function mapExecution(record: {
  id: string
  procedureId: string
  procedureNameSnapshot: string
  procedureCodeSnapshot: string | null
  origin: string
  scheduledProcedureId: string | null
  status: string
  reasonCode: string | null
  reasonNote: string | null
  toothNumber: string | null
  dentition: string | null
  surfaces: string
  catalogPriceSnapshot: number | null
  expectedPrice: number | null
  performedPrice: number | null
  notes: string | null
  professionalName: string | null
  odontogramEventId: string | null
  performedAt: Date | null
  createdAt: Date
}): ProcedureExecutionView {
  const origin: ProcedureOrigin =
    record.origin === "scheduled" ? "scheduled" : "added_in_attendance"
  const status = record.status as ProcedureExecutionStatus
  const isScheduled = record.scheduledProcedureId !== null

  const comparison = compareScheduledVsPerformed({ origin, status, isScheduled })
  const valueComparison = compareValues(record.expectedPrice, record.performedPrice)

  return {
    id: record.id,
    procedureId: record.procedureId,
    procedureNameSnapshot: record.procedureNameSnapshot,
    procedureCodeSnapshot: record.procedureCodeSnapshot,
    origin,
    scheduledProcedureId: record.scheduledProcedureId,
    status,
    reasonCode: record.reasonCode,
    reasonLabel: getProcedureReasonLabel(record.reasonCode),
    reasonNote: record.reasonNote,
    toothNumber: record.toothNumber,
    dentition: record.dentition,
    surfaces: procedureSurfacesToList(record.surfaces),
    catalogPriceSnapshot: record.catalogPriceSnapshot,
    expectedPrice: record.expectedPrice,
    performedPrice: record.performedPrice,
    comparison,
    valueDifference: valueComparison.difference,
    valueDiffers: valueComparison.isDifferent,
    notes: record.notes,
    professionalName: record.professionalName,
    odontogramEventId: record.odontogramEventId,
    performedAt: record.performedAt ? record.performedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function getProcedures(
  attendanceId: string
): Promise<ProceduresResponse | null> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) return null

  const [scheduledRows, executionRows] = await Promise.all([
    prisma.appointmentProcedure.findMany({
      where: { appointmentId: appointment.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        procedureId: true,
        procedureNameSnapshot: true,
        unitPrice: true,
        quantity: true,
        totalPrice: true,
      },
    }),
    prisma.appointmentProcedureExecution.findMany({
      where: { appointmentId: appointment.id },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        procedureId: true,
        procedureNameSnapshot: true,
        procedureCodeSnapshot: true,
        origin: true,
        scheduledProcedureId: true,
        status: true,
        reasonCode: true,
        reasonNote: true,
        toothNumber: true,
        dentition: true,
        surfaces: true,
        catalogPriceSnapshot: true,
        expectedPrice: true,
        performedPrice: true,
        notes: true,
        professionalName: true,
        odontogramEventId: true,
        performedAt: true,
        createdAt: true,
      },
    }),
  ])

  // Mapa por item da Agenda para mostrar, no bloco "previstos", o estado da
  // execução correspondente (o previsto continua sendo do previsto).
  const executionByScheduled = new Map<string, string>()
  for (const execution of executionRows) {
    if (execution.scheduledProcedureId) {
      executionByScheduled.set(execution.scheduledProcedureId, execution.id)
    }
  }

  const scheduled: ScheduledProcedureView[] = scheduledRows.map((row) => ({
    id: row.id,
    procedureId: row.procedureId,
    procedureNameSnapshot: row.procedureNameSnapshot,
    unitPrice: row.unitPrice,
    quantity: row.quantity,
    totalPrice: row.totalPrice,
    executionId: executionByScheduled.get(row.id) ?? null,
    origin: "scheduled",
  }))

  const executions = executionRows.map(mapExecution)

  // --- Resumo derivado dos DADOS REAIS (nunca mockado) ---
  const performed = executions.filter((e) => isPerformed(e.status))
  const notPerformed = executions.filter((e) => e.status === "not_performed")
  const pending = executions.filter(
    (e) => e.status === "pending" || e.status === "in_progress"
  )
  const added = executions.filter((e) => e.origin === "added_in_attendance")

  // Valor previsto: a Agenda é a fonte (não a execução).
  const expectedTotal = round(
    scheduled.reduce((sum, item) => sum + item.totalPrice, 0)
  )
  // Valor realizado: somente o que foi confirmado como realizado.
  const performedTotal = round(
    performed.reduce((sum, item) => sum + (item.performedPrice ?? 0), 0)
  )

  return {
    appointment: {
      id: appointment.id,
      code: buildCode(appointment.id),
      date: appointment.appointmentDate.toISOString().split("T")[0],
      time: appointment.appointmentTime || null,
      status: appointment.status,
      isOpen: appointment.status === "in_progress",
    },
    patient: {
      id: appointment.patient.id,
      fullName: appointment.patient.fullName,
      cpf: appointment.patient.cpf,
    },
    professional: null,
    scheduled,
    executions,
    summary: {
      scheduledCount: scheduled.length,
      performedCount: performed.length,
      notPerformedCount: notPerformed.length,
      pendingCount: pending.length,
      addedCount: added.length,
      expectedTotal,
      performedTotal,
      differenceTotal: round(performedTotal - expectedTotal),
      hasValueDifference: executions.some((e) => e.valueDiffers),
    },
    catalog: {
      reasons: [
        { code: "patient_not_authorized", label: "Paciente não autorizou" },
        { code: "postponed", label: "Procedimento adiado" },
        {
          code: "needs_further_evaluation",
          label: "Necessidade de avaliação adicional",
        },
        { code: "patient_unfit", label: "Paciente não apresentou condições" },
        { code: "patient_absent", label: "Paciente não compareceu" },
        { code: "other", label: "Outro" },
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// Escrita — registrar execução
// ---------------------------------------------------------------------------

// Registra a execução de um procedimento no atendimento.
//
// Regras validadas NO SERVIDOR (autoridade final):
// - O atendimento precisa existir e estar em andamento.
// - O procedimento precisa existir no catálogo REAL e estar ativo.
// - Registro vindo da Agenda precisa referenciar um item real do atendimento.
// - Alteração de valor só é aceita se o procedimento permitir
//   (allowPriceOverride). Caso contrário, o valor realizado fica igual ao
//   previsto/catálogo.
// - Procedimento realizado com dente gera o evento no ODONTOGRAMA (fonte da
//   verdade clínica) e guarda a referência do evento.
// - Alterações relevantes são registradas na trilha de auditoria.
export async function registerExecution(
  attendanceId: string,
  input: RegisterProcedureExecutionInput
): Promise<{ ok: true; executionId: string } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  if (appointment.status !== "in_progress") {
    return {
      error:
        appointment.status === "completed"
          ? "Este atendimento já foi finalizado. Os procedimentos estão fechados e não podem ser alterados livremente."
          : "Os procedimentos só podem ser registrados durante o atendimento. Inicie o atendimento para continuar.",
      code: "ATTENDANCE_NOT_OPEN",
      status: 409,
    }
  }

  // Catálogo REAL — nunca duplicado.
  const procedure = await prisma.procedure.findUnique({
    where: { id: input.procedureId },
    select: {
      id: true,
      name: true,
      code: true,
      defaultPrice: true,
      allowPriceOverride: true,
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

  // --- Item da Agenda de origem (quando aplicável) ---
  let scheduledItem: {
    id: string
    unitPrice: number
    quantity: number
    totalPrice: number
  } | null = null

  if (input.origin === "scheduled") {
    scheduledItem = await prisma.appointmentProcedure.findFirst({
      where: {
        id: input.scheduledProcedureId!,
        // Isolamento: o item precisa pertencer a ESTE atendimento.
        appointmentId: appointment.id,
      },
      select: { id: true, unitPrice: true, quantity: true, totalPrice: true },
    })

    if (!scheduledItem) {
      return {
        error: "Procedimento da Agenda não encontrado neste atendimento.",
        code: "SCHEDULED_NOT_FOUND",
        status: 404,
      }
    }
  }

  // --- Normalização de dente/superfície ---
  const surfaces = normalizeProcedureSurfaces(input.surfaces ?? [])
  const toothNumber: string | null = input.toothNumber ?? null
  let dentition: string | null = input.dentition ?? null

  if (toothNumber) {
    const tooth = getToothDefinition(toothNumber)
    if (!tooth) {
      return {
        error: `Dente "${toothNumber}" não é um número FDI válido.`,
        code: "INVALID_TOOTH",
        status: 400,
      }
    }
    // A dentição é derivada do próprio dente quando não informada — evita
    // registrar um dente permanente como se fosse decíduo.
    dentition = input.dentition ?? tooth.dentition
    if (dentition !== tooth.dentition) {
      return {
        error: `O dente ${toothNumber} não pertence à dentição informada.`,
        code: "WRONG_DENTITION",
        status: 400,
      }
    }
  } else {
    dentition = null
  }

  // --- Status e valores ---
  const status: ProcedureExecutionStatus =
    input.status ??
    (input.origin === "scheduled" ? "pending" : "performed")

  // Não realizado exige motivo (reforço da validação Zod).
  if (status === "not_performed" && !input.reasonCode) {
    return {
      error: "Informe o motivo da não realização.",
      code: "REASON_REQUIRED",
      status: 422,
    }
  }

  const expectedPrice =
    scheduledItem !== null ? round(scheduledItem.totalPrice) : null

  // Regra de alteração de valor (validada no servidor).
  const requestedPrice =
    typeof input.performedPrice === "number" ? round(input.performedPrice) : null

  let performedPrice: number | null = null
  if (status === "performed") {
    if (requestedPrice !== null) {
      if (!procedure.allowPriceOverride) {
        return {
          error: `O procedimento "${procedure.name}" não permite alteração de valor.`,
          code: "PRICE_OVERRIDE_NOT_ALLOWED",
          status: 422,
        }
      }
      performedPrice = requestedPrice
    } else {
      // Sem valor informado: usa o previsto (Agenda) ou o do catálogo.
      performedPrice = expectedPrice ?? procedure.defaultPrice ?? null
    }
  }

  const now = new Date()

  // --- Verificação de duplicidade (aviso, não bloqueio silencioso) ---
  const existing = await prisma.appointmentProcedureExecution.findMany({
    where: { appointmentId: appointment.id },
    select: { procedureId: true, toothNumber: true, surfaces: true, status: true },
  })

  const duplicate = findDuplicate(existing, {
    procedureId: procedure.id,
    toothNumber,
    surfaces,
  })
  if (duplicate && status === "performed") {
    return {
      error:
        "Já existe um procedimento realizado igual (mesmo procedimento, dente e superfícies) neste atendimento.",
      code: "DUPLICATE_EXECUTION",
      status: 409,
    }
  }

  const execution = await prisma.$transaction(async (tx) => {
    const created = await tx.appointmentProcedureExecution.create({
      data: {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        procedureId: procedure.id,
        procedureNameSnapshot: procedure.name,
        procedureCodeSnapshot: procedure.code,
        origin: input.origin,
        scheduledProcedureId: scheduledItem?.id ?? null,
        status,
        reasonCode: input.reasonCode ?? null,
        reasonNote: input.reasonNote ?? null,
        toothNumber,
        dentition,
        surfaces,
        catalogPriceSnapshot: procedure.defaultPrice,
        expectedPrice,
        performedPrice,
        notes: input.notes ?? null,
        professionalName: input.professionalName ?? null,
        performedAt: status === "performed" ? now : null,
      },
      select: { id: true },
    })

    await tx.procedureExecutionChangeLog.create({
      data: {
        executionId: created.id,
        patientId: appointment.patientId,
        field: "created",
        label: "Registro de procedimento",
        oldValue: null,
        newValue: `${procedure.name} — ${status}`,
        changedByName: input.professionalName ?? null,
      },
    })

    return created
  })

  // --- Integração com o ODONTOGRAMA (fonte da verdade clínica) ---
  // Somente procedimento REALIZADO com dente gera evento clínico. Um
  // procedimento pendente/não realizado NÃO altera a situação odontológica.
  if (status === "performed" && toothNumber) {
    const eventResult = await registerEvent(attendanceId, {
      kind: "procedure",
      procedureId: procedure.id,
      toothNumbers: [toothNumber],
      dentition: (dentition ?? "permanent") as Dentition,
      surfaces: surfaces ? (surfaces.split(",") as ToothSurface[]) : [],
      status: "performed",
      notes: input.notes ?? null,
      professionalName: input.professionalName ?? null,
    })

    if (!("error" in eventResult)) {
      // Guarda a referência do evento gerado no odontograma.
      await prisma.appointmentProcedureExecution.update({
        where: { id: execution.id },
        data: { odontogramEventId: await findLatestEventId(appointment.patientId, toothNumber) },
      })
    }
  }

  return { ok: true, executionId: execution.id }
}

// Busca o evento de procedimento mais recente do dente (para vincular a
// execução ao evento clínico gerado). Mantém a integridade sem criar uma
// segunda estrutura de dentes.
async function findLatestEventId(
  patientId: string,
  toothNumber: string
): Promise<string | null> {
  const event = await prisma.odontogramEvent.findFirst({
    where: { patientId, toothNumber, kind: "procedure", status: "performed" },
    orderBy: { occurredAt: "desc" },
    select: { id: true },
  })
  return event?.id ?? null
}

// ---------------------------------------------------------------------------
// Escrita — atualizar status (marcar como realizado / não realizado / cancelado)
// ---------------------------------------------------------------------------

export async function updateExecution(
  attendanceId: string,
  executionId: string,
  input: UpdateProcedureExecutionInput
): Promise<{ ok: true; executionId: string } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  if (appointment.status !== "in_progress") {
    return {
      error:
        appointment.status === "completed"
          ? "Este atendimento já foi finalizado. Os procedimentos estão fechados e não podem ser alterados livremente."
          : "O atendimento precisa estar em andamento para registrar alterações.",
      code: "ATTENDANCE_NOT_OPEN",
      status: 409,
    }
  }

  const execution = await prisma.appointmentProcedureExecution.findFirst({
    where: {
      id: executionId,
      // Isolamento: a execução precisa pertencer ao paciente do atendimento.
      patientId: appointment.patientId,
    },
    select: {
      id: true,
      appointmentId: true,
      procedureId: true,
      procedureNameSnapshot: true,
      origin: true,
      scheduledProcedureId: true,
      status: true,
      reasonCode: true,
      reasonNote: true,
      toothNumber: true,
      dentition: true,
      surfaces: true,
      catalogPriceSnapshot: true,
      expectedPrice: true,
      performedPrice: true,
      notes: true,
      odontogramEventId: true,
    },
  })

  if (!execution) {
    return {
      error: "Procedimento não encontrado para este paciente.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  // Confirmação de execução só pode ser feita no atendimento corrente. A
  // execução pode pertencer a um atendimento anterior (histórico) — nesse
  // caso, alterações exigem o fluxo de correção (não implementado aqui).
  if (execution.appointmentId !== appointment.id) {
    return {
      error:
        "Este procedimento pertence a outro atendimento. Alterações devem ser feitas no atendimento de origem.",
      code: "WRONG_APPOINTMENT",
      status: 409,
    }
  }

  // Transição de idempotência: marcar como realizado o que já está realizado
  // não é um erro (o cliente pode reenviar), mas não gera registro novo.
  const nextStatus = input.status
  if (execution.status === nextStatus) {
    return { ok: true, executionId: execution.id }
  }

  // Não realizado exige motivo.
  const nextReasonCode =
    nextStatus === "not_performed"
      ? input.reasonCode ?? execution.reasonCode ?? null
      : null

  if (nextStatus === "not_performed" && !nextReasonCode) {
    return {
      error: "Informe o motivo da não realização.",
      code: "REASON_REQUIRED",
      status: 422,
    }
  }

  // --- Dente / superfície (pode ser ajustado no momento da confirmação) ---
  const surfaces = normalizeProcedureSurfaces(
    input.surfaces && input.surfaces.length > 0
      ? input.surfaces
      : procedureSurfacesToList(execution.surfaces)
  )

  const toothNumber: string | null =
    input.toothNumber !== undefined ? input.toothNumber : execution.toothNumber
  let dentition: string | null =
    input.dentition !== undefined ? input.dentition : execution.dentition

  if (toothNumber) {
    const tooth = getToothDefinition(toothNumber)
    if (!tooth) {
      return {
        error: `Dente "${toothNumber}" não é um número FDI válido.`,
        code: "INVALID_TOOTH",
        status: 400,
      }
    }
    dentition = dentition ?? tooth.dentition
    if (dentition !== tooth.dentition) {
      return {
        error: `O dente ${toothNumber} não pertence à dentição informada.`,
        code: "WRONG_DENTITION",
        status: 400,
      }
    }
  } else {
    dentition = null
  }

  // --- Valores ---
  const procedure = await prisma.procedure.findUnique({
    where: { id: execution.procedureId },
    select: { name: true, defaultPrice: true, allowPriceOverride: true },
  })

  if (!procedure) {
    return {
      error: "Procedimento não encontrado no catálogo.",
      code: "UNKNOWN_PROCEDURE",
      status: 404,
    }
  }

  const requestedPrice =
    typeof input.performedPrice === "number"
      ? round(input.performedPrice)
      : null

  // Ao confirmar realização, define o valor realizado.
  let performedPrice = execution.performedPrice
  if (nextStatus === "performed") {
    if (requestedPrice !== null) {
      if (!procedure.allowPriceOverride) {
        return {
          error: `O procedimento "${procedure.name}" não permite alteração de valor.`,
          code: "PRICE_OVERRIDE_NOT_ALLOWED",
          status: 422,
        }
      }
      performedPrice = requestedPrice
    } else {
      performedPrice =
        performedPrice ??
        execution.expectedPrice ??
        procedure.defaultPrice ??
        null
    }
  }

  // Não realizado / cancelado NÃO mantém valor realizado (não alimenta o
  // financeiro futuro). O valor previsto permanece intacto.
  if (nextStatus === "not_performed" || nextStatus === "cancelled") {
    performedPrice = null
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.appointmentProcedureExecution.update({
      where: { id: execution.id },
      data: {
        status: nextStatus,
        reasonCode: nextReasonCode,
        reasonNote:
          nextStatus === "not_performed"
            ? input.reasonNote ?? execution.reasonNote
            : null,
        toothNumber,
        dentition,
        surfaces,
        performedPrice,
        notes: input.notes ?? execution.notes,
        professionalName: input.professionalName ?? null,
        performedAt: nextStatus === "performed" ? now : null,
      },
    })

    // Auditoria: registra a transição com valores antes/depois.
    await tx.procedureExecutionChangeLog.create({
      data: {
        executionId: execution.id,
        patientId: appointment.patientId,
        field: "status",
        label: execution.procedureNameSnapshot,
        oldValue: execution.status,
        newValue: nextStatus,
        changedByName: input.professionalName ?? null,
      },
    })

    if (performedPrice !== execution.performedPrice) {
      await tx.procedureExecutionChangeLog.create({
        data: {
          executionId: execution.id,
          patientId: appointment.patientId,
          field: "value",
          label: execution.procedureNameSnapshot,
          oldValue:
            execution.performedPrice !== null
              ? String(execution.performedPrice)
              : null,
          newValue: performedPrice !== null ? String(performedPrice) : null,
          changedByName: input.professionalName ?? null,
        },
      })
    }
  })

  // --- Integração com o ODONTOGRAMA ao confirmar realização ---
  // Ao marcar como realizado um procedimento com dente, registra/vincula o
  // evento clínico. Isso mantém a situação odontológica consistente e o
  // histórico do dente completo (a cárie previamente registrada é resolvida
  // pelo serviço do odontograma, mas NUNCA apagada).
  if (nextStatus === "performed" && toothNumber && !execution.odontogramEventId) {
    const eventResult = await registerEvent(attendanceId, {
      kind: "procedure",
      procedureId: execution.procedureId,
      toothNumbers: [toothNumber],
      dentition: (dentition ?? "permanent") as Dentition,
      surfaces: surfaces ? (surfaces.split(",") as ToothSurface[]) : [],
      status: "performed",
      notes: input.notes ?? execution.notes ?? null,
      professionalName: input.professionalName ?? null,
    })

    if (!("error" in eventResult)) {
      const eventId = await findLatestEventId(appointment.patientId, toothNumber)
      await prisma.appointmentProcedureExecution.update({
        where: { id: execution.id },
        data: { odontogramEventId: eventId },
      })
    }
  }

  return { ok: true, executionId: execution.id }
}

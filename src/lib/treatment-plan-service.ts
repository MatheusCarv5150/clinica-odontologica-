import { prisma } from "@/lib/prisma"
import {
  collectPlannedTeeth,
  formatPlanToothReference,
  getTreatmentPlanItemStatusMeta,
  normalizePlanSurfaces,
  planSurfacesToList,
  resolvePlanTooth,
  summarizePlan,
  type TreatmentPlanItemStatus,
} from "@/lib/treatment-plan-domain"
import type {
  CreateTreatmentPlanInput,
  CreateTreatmentPlanItemInput,
  TreatmentPlanItemView,
  TreatmentPlansResponse,
  TreatmentPlanView,
  UpdateTreatmentPlanInput,
  UpdateTreatmentPlanItemInput,
} from "@/lib/schemas-treatment-plan"

// ===========================================================================
// SERVIÇO DO PLANO DE TRATAMENTO (Parte 10.1).
//
// RESPONSABILIDADES
// - Visão longitudinal do cuidado, vinculada ao PACIENTE (e opcionalmente ao
//   atendimento de origem).
// - Resolver o paciente SEMPRE a partir do atendimento (isolamento/LGPD).
// - Reutilizar o catálogo REAL de procedimentos (com snapshot).
// - Usar a MESMA convenção de dente/superfície do odontograma.
// - Preservar histórico: mudanças de status geram trilha de auditoria.
//
// NÃO FAZ:
// - não altera o estado clínico do dente (PLANEJADO ≠ REALIZADO);
// - não cria execução de procedimento (isso é ação explícita no atendimento);
// - não altera a Agenda nem o Financeiro.
// ===========================================================================

export type ServiceError = { error: string; code: string; status: number }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function toIsoDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function fromIsoDate(value: Date | null): string | null {
  return value ? value.toISOString().split("T")[0] : null
}

// Resolve o atendimento + paciente. Toda operação parte daqui, garantindo o
// isolamento entre pacientes.
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

// ---------------------------------------------------------------------------
// Mapeamento
// ---------------------------------------------------------------------------

type PlanItemRow = {
  id: string
  planId: string
  procedureId: string | null
  procedureNameSnapshot: string
  procedureCodeSnapshot: string | null
  toothNumber: string | null
  dentition: string | null
  surfaces: string
  description: string | null
  priority: string
  expectedPrice: number | null
  quantity: number
  stage: string | null
  stageOrder: number
  position: number
  status: string
  plannedDate: Date | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

function mapItem(row: PlanItemRow): TreatmentPlanItemView {
  return {
    id: row.id,
    planId: row.planId,
    procedureId: row.procedureId,
    procedureNameSnapshot: row.procedureNameSnapshot,
    procedureCodeSnapshot: row.procedureCodeSnapshot,
    toothNumber: row.toothNumber,
    dentition: row.dentition,
    surfaces: planSurfacesToList(row.surfaces),
    description: row.description,
    priority: row.priority,
    expectedPrice: row.expectedPrice,
    quantity: row.quantity,
    stage: row.stage,
    stageOrder: row.stageOrder,
    position: row.position,
    status: row.status,
    plannedDate: row.plannedDate ? fromIsoDate(row.plannedDate) : null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function getTreatmentPlans(
  attendanceId: string
): Promise<TreatmentPlansResponse | null> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) return null

  const plans = await prisma.treatmentPlan.findMany({
    where: { patientId: appointment.patientId },
    orderBy: { createdAt: "desc" },
    include: {
      items: { orderBy: [{ stageOrder: "asc" }, { position: "asc" }, { createdAt: "asc" }] },
      // Histórico recente do plano (para a aba de histórico).
    },
  })

  const planIds = plans.map((plan) => plan.id)

  // Trilha de auditoria dos itens (agrupada por item) — uma única consulta.
  const changeLogs =
    planIds.length > 0
      ? await prisma.treatmentPlanItemChangeLog.findMany({
          where: {
            item: { planId: { in: planIds } },
          },
          orderBy: { changedAt: "desc" },
          select: {
            id: true,
            itemId: true,
            field: true,
            label: true,
            oldValue: true,
            newValue: true,
            reason: true,
            changedByName: true,
            changedAt: true,
          },
        })
      : []

  const changesByItem = new Map<string, typeof changeLogs>()
  for (const log of changeLogs) {
    const list = changesByItem.get(log.itemId) ?? []
    list.push(log)
    changesByItem.set(log.itemId, list)
  }

  const patientPlans: TreatmentPlanView[] = plans.map((plan) => {
    const items = plan.items.map(mapItem)
    const summary = summarizePlan(items)

    // O histórico do plano reúne as mudanças de TODOS os seus itens,
    // ordenadas da mais recente para a mais antiga.
    const planLogs = items
      .flatMap((item) => changesByItem.get(item.id) ?? [])
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())

    return {
      id: plan.id,
      title: plan.title,
      description: plan.description,
      notes: plan.notes,
      status: plan.status,
      professionalName: plan.professionalName,
      plannedDate: plan.plannedDate ? fromIsoDate(plan.plannedDate) : null,
      createdInAppointmentId: plan.createdInAppointmentId,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      items,
      summary,
      changes: planLogs.map((log) => ({
        id: log.id,
        field: log.field,
        label: log.label,
        oldValue: log.oldValue,
        newValue: log.newValue,
        reason: log.reason,
        changedByName: log.changedByName,
        changedAt: log.changedAt.toISOString(),
      })),
    }
  })

  const allItems = patientPlans.flatMap((plan) => plan.items)

  return {
    patient: {
      id: appointment.patient.id,
      fullName: appointment.patient.fullName,
      cpf: appointment.patient.cpf,
    },
    plans: patientPlans,
    plannedTeeth: Array.from(collectPlannedTeeth(allItems)).sort(),
    totals: {
      plansCount: patientPlans.length,
      openItemsCount: allItems.filter(
        (item) =>
          item.status !== "completed" &&
          item.status !== "cancelled" &&
          item.status !== "not_done"
      ).length,
      completedItemsCount: allItems.filter((item) => item.status === "completed")
        .length,
      estimatedTotal: round(
        allItems
          .filter((item) => item.status !== "cancelled")
          .reduce(
            (sum, item) => sum + (item.expectedPrice ?? 0) * Math.max(1, item.quantity),
            0
          )
      ),
    },
  }
}

// ---------------------------------------------------------------------------
// Escrita — criar plano
// ---------------------------------------------------------------------------

export async function createPlan(
  attendanceId: string,
  input: CreateTreatmentPlanInput
): Promise<{ ok: true; planId: string } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const plan = await prisma.treatmentPlan.create({
    data: {
      patientId: appointment.patientId,
      title: input.title,
      description: input.description,
      notes: input.notes,
      status: input.status,
      professionalName: input.professionalName,
      plannedDate: toIsoDate(input.plannedDate ?? null),
      createdInAppointmentId: appointment.id,
      createdByName: input.professionalName,
    },
    select: { id: true },
  })

  return { ok: true, planId: plan.id }
}

// ---------------------------------------------------------------------------
// Escrita — atualizar plano
// ---------------------------------------------------------------------------

export async function updatePlan(
  attendanceId: string,
  planId: string,
  input: UpdateTreatmentPlanInput
): Promise<{ ok: true; planId: string } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: planId, patientId: appointment.patientId },
    select: { id: true, status: true },
  })

  if (!plan) {
    return {
      error: "Plano de tratamento não encontrado para este paciente.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  await prisma.treatmentPlan.update({
    where: { id: plan.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.professionalName !== undefined
        ? { professionalName: input.professionalName }
        : {}),
      ...(input.plannedDate !== undefined
        ? { plannedDate: toIsoDate(input.plannedDate) }
        : {}),
    },
  })

  return { ok: true, planId: plan.id }
}

// ---------------------------------------------------------------------------
// Escrita — criar item do plano
// ---------------------------------------------------------------------------

export async function createPlanItem(
  attendanceId: string,
  planId: string,
  input: CreateTreatmentPlanItemInput
): Promise<{ ok: true; itemId: string } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: planId, patientId: appointment.patientId },
    select: { id: true, patientId: true },
  })

  if (!plan) {
    return {
      error: "Plano de tratamento não encontrado para este paciente.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  // --- Procedimento do catálogo REAL (nunca duplicado) ---
  let procedure: {
    id: string
    name: string
    code: string
    defaultPrice: number | null
  } | null = null

  if (input.procedureId) {
    procedure = await prisma.procedure.findUnique({
      where: { id: input.procedureId },
      select: { id: true, name: true, code: true, defaultPrice: true },
    })

    if (!procedure) {
      return {
        error: "Procedimento não encontrado no catálogo.",
        code: "UNKNOWN_PROCEDURE",
        status: 404,
      }
    }
  }

  // --- Dente/superfície: MESMA convenção do odontograma ---
  const surfaces = normalizePlanSurfaces(input.surfaces ?? [])
  const tooth = resolvePlanTooth(input.toothNumber ?? null, input.dentition)

  if (input.toothNumber && !tooth) {
    return {
      error: `Dente "${input.toothNumber}" não é um número FDI válido para a dentição informada.`,
      code: "INVALID_TOOTH",
      status: 400,
    }
  }

  // Valor previsto: usa o informado; senão o preço do catálogo.
  const expectedPrice =
    input.expectedPrice !== undefined && input.expectedPrice !== null
      ? round(input.expectedPrice)
      : (procedure?.defaultPrice ?? null)

  const position =
    input.position ??
    (await prisma.treatmentPlanItem.count({ where: { planId: plan.id } }))

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.treatmentPlanItem.create({
      data: {
        planId: plan.id,
        patientId: appointment.patientId,
        procedureId: procedure?.id ?? null,
        procedureNameSnapshot: procedure?.name ?? input.description ?? "Item do plano",
        procedureCodeSnapshot: procedure?.code ?? null,
        toothNumber: tooth?.toothNumber ?? null,
        dentition: tooth?.dentition ?? null,
        surfaces,
        description: input.description ?? null,
        priority: input.priority,
        expectedPrice,
        quantity: input.quantity,
        stage: input.stage ?? null,
        stageOrder: input.stageOrder,
        position,
        status: input.status,
        plannedDate: toIsoDate(input.plannedDate ?? null),
        notes: input.notes ?? null,
      },
      select: { id: true },
    })

    await tx.treatmentPlanItemChangeLog.create({
      data: {
        itemId: created.id,
        patientId: appointment.patientId,
        field: "created",
        label: procedure?.name ?? input.description ?? "Item do plano",
        oldValue: null,
        newValue: getTreatmentPlanItemStatusMeta(input.status).label,
        reason: null,
        changedByName: null,
      },
    })

    return created
  })

  return { ok: true, itemId: item.id }
}

// ---------------------------------------------------------------------------
// Escrita — atualizar item (inclui mudança de status com auditoria)
// ---------------------------------------------------------------------------

export async function updatePlanItem(
  attendanceId: string,
  planId: string,
  itemId: string,
  input: UpdateTreatmentPlanItemInput
): Promise<{ ok: true; itemId: string } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const item = await prisma.treatmentPlanItem.findFirst({
    where: { id: itemId, planId, patientId: appointment.patientId },
    select: {
      id: true,
      planId: true,
      procedureId: true,
      procedureNameSnapshot: true,
      toothNumber: true,
      dentition: true,
      surfaces: true,
      status: true,
      expectedPrice: true,
      quantity: true,
      priority: true,
      description: true,
      stage: true,
      stageOrder: true,
      position: true,
      plannedDate: true,
      notes: true,
    },
  })

  if (!item) {
    return {
      error: "Item do plano não encontrado para este paciente.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  // --- Procedimento (quando alterado) ---
  let procedure: {
    id: string
    name: string
    code: string
  } | null = null

  if (input.procedureId !== undefined) {
    if (input.procedureId) {
      procedure = await prisma.procedure.findUnique({
        where: { id: input.procedureId },
        select: { id: true, name: true, code: true },
      })
      if (!procedure) {
        return {
          error: "Procedimento não encontrado no catálogo.",
          code: "UNKNOWN_PROCEDURE",
          status: 404,
        }
      }
    }
  }

  // --- Dente/superfície (quando alterados) ---
  const nextToothNumber =
    input.toothNumber !== undefined ? input.toothNumber : item.toothNumber
  const tooth = resolvePlanTooth(nextToothNumber, input.dentition ?? undefined)

  if (nextToothNumber && !tooth) {
    return {
      error: `Dente "${nextToothNumber}" não é um número FDI válido para a dentição informada.`,
      code: "INVALID_TOOTH",
      status: 400,
    }
  }

  const nextSurfaces =
    input.surfaces !== undefined
      ? normalizePlanSurfaces(input.surfaces)
      : item.surfaces

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.treatmentPlanItem.update({
      where: { id: item.id },
      data: {
        ...(input.procedureId !== undefined
          ? {
              procedureId: procedure?.id ?? null,
              procedureNameSnapshot:
                procedure?.name ??
                input.description ??
                item.description ??
                item.procedureNameSnapshot,
              procedureCodeSnapshot: procedure?.code ?? null,
            }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        toothNumber: tooth?.toothNumber ?? null,
        dentition: tooth?.dentition ?? null,
        surfaces: nextSurfaces,
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.expectedPrice !== undefined
          ? { expectedPrice: input.expectedPrice }
          : {}),
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.stage !== undefined ? { stage: input.stage } : {}),
        ...(input.stageOrder !== undefined
          ? { stageOrder: input.stageOrder }
          : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.plannedDate !== undefined
          ? { plannedDate: toIsoDate(input.plannedDate) }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    })

    // Auditoria: registra a transição de status com valores antes/depois.
    if (input.status && input.status !== item.status) {
      await tx.treatmentPlanItemChangeLog.create({
        data: {
          itemId: item.id,
          patientId: appointment.patientId,
          field: "status",
          label: item.procedureNameSnapshot,
          oldValue: getTreatmentPlanItemStatusMeta(item.status).label,
          newValue: getTreatmentPlanItemStatusMeta(input.status).label,
          reason: input.statusReason ?? null,
          changedByName: input.performedByName ?? null,
          changedAt: now,
        },
      })
    }

    // Auditoria: dente/superfície alterados.
    if (input.toothNumber !== undefined || input.surfaces !== undefined) {
      const before = formatPlanToothReference(
        item.toothNumber,
        planSurfacesToList(item.surfaces)
      )
      const after = formatPlanToothReference(
        tooth?.toothNumber ?? null,
        planSurfacesToList(nextSurfaces)
      )
      if (before !== after) {
        await tx.treatmentPlanItemChangeLog.create({
          data: {
            itemId: item.id,
            patientId: appointment.patientId,
            field: "tooth",
            label: item.procedureNameSnapshot,
            oldValue: before,
            newValue: after,
            reason: null,
            changedByName: input.performedByName ?? null,
            changedAt: now,
          },
        })
      }
    }
  })

  return { ok: true, itemId: item.id }
}

// ---------------------------------------------------------------------------
// Escrita — remover item (exclusão LÓGICA via status, preservando histórico)
// ---------------------------------------------------------------------------

export async function archivePlanItem(
  attendanceId: string,
  planId: string,
  itemId: string,
  performedByName: string | null,
  reason: string | null
): Promise<{ ok: true } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const item = await prisma.treatmentPlanItem.findFirst({
    where: { id: itemId, planId, patientId: appointment.patientId },
    select: { id: true, status: true, procedureNameSnapshot: true },
  })

  if (!item) {
    return {
      error: "Item do plano não encontrado para este paciente.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  // NÃO apagamos o item: o histórico clínico é preservado. O item é marcado
  // como cancelado e a mudança é auditada.
  await prisma.$transaction(async (tx) => {
    await tx.treatmentPlanItem.update({
      where: { id: item.id },
      data: { status: "cancelled" satisfies TreatmentPlanItemStatus },
    })

    await tx.treatmentPlanItemChangeLog.create({
      data: {
        itemId: item.id,
        patientId: appointment.patientId,
        field: "status",
        label: item.procedureNameSnapshot,
        oldValue: getTreatmentPlanItemStatusMeta(item.status).label,
        newValue: getTreatmentPlanItemStatusMeta("cancelled").label,
        reason: reason ?? "Item removido do plano pelo profissional.",
        changedByName: performedByName,
      },
    })
  })

  return { ok: true }
}

import { prisma } from "@/lib/prisma"
import { buildFriendlyCode } from "@/lib/attendance-status"
import { canCancelPrescription, canEditPrescription } from "@/lib/prescription-domain"
import type {
  CancelPrescriptionInput,
  CreatePrescriptionInput,
  PrescriptionItemView,
  PrescriptionLogView,
  PrescriptionView,
  PrescriptionsResponse,
  UpdatePrescriptionInput,
} from "@/lib/schemas-prescription"

// ===========================================================================
// SERVIÇO DA PRESCRIÇÃO (Parte 10.2).
//
// RESPONSABILIDADES
// - Registrar prescrições vinculadas ao PACIENTE e ao ATENDIMENTO.
// - Resolver o paciente SEMPRE a partir do atendimento (isolamento/LGPD).
// - Preservar o histórico: prescrição emitida nunca é sobrescrita/apagada.
//   Para invalidá-la, cancela-se com data/autor/motivo.
//
// NÃO FAZ (por definição):
// - não sugere, insere ou infere medicamentos;
// - não calcula dose/posologia;
// - não gera PDF (a arquitetura fica pronta: os dados já estão estruturados).
// ===========================================================================

export type ServiceError = { error: string; code: string; status: number }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

type PrescriptionItemRow = {
  id: string
  name: string
  activeIngredient: string | null
  presentation: string | null
  concentration: string | null
  quantity: number | null
  unit: string | null
  route: string | null
  dose: string | null
  frequency: string | null
  duration: string | null
  instructions: string | null
  observations: string | null
  position: number
}

function mapItem(row: PrescriptionItemRow): PrescriptionItemView {
  return { ...row }
}

type PrescriptionLogRow = {
  id: string
  event: string
  label: string
  notes: string | null
  performedByName: string | null
  createdAt: Date
}

function mapLog(row: PrescriptionLogRow): PrescriptionLogView {
  return {
    id: row.id,
    event: row.event,
    label: row.label,
    notes: row.notes,
    performedByName: row.performedByName,
    createdAt: row.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function getPrescriptions(
  attendanceId: string
): Promise<PrescriptionsResponse | null> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) return null

  const rows = await prisma.prescription.findMany({
    where: { patientId: appointment.patientId },
    orderBy: { createdAt: "desc" },
    include: {
      items: { orderBy: { position: "asc" } },
      logs: { orderBy: { createdAt: "desc" } },
    },
  })

  const prescriptions: PrescriptionView[] = rows.map((row) => ({
    id: row.id,
    status: row.status,
    notes: row.notes,
    guidance: row.guidance,
    professionalName: row.professionalName,
    appointmentId: row.appointmentId,
    appointmentCode: row.appointmentId ? buildFriendlyCode(row.appointmentId) : null,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelReason: row.cancelReason,
    cancelledByName: row.cancelledByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: row.items.map(mapItem),
    logs: row.logs.map(mapLog),
  }))

  const allItems = prescriptions.flatMap((p) => p.items)

  return {
    patient: {
      id: appointment.patient.id,
      fullName: appointment.patient.fullName,
      cpf: appointment.patient.cpf,
    },
    appointment: {
      id: appointment.id,
      code: buildFriendlyCode(appointment.id),
      date: appointment.appointmentDate.toISOString().split("T")[0],
      time: appointment.appointmentTime || null,
    },
    professional: null,
    prescriptions,
    totals: {
      prescriptionsCount: prescriptions.length,
      issuedCount: prescriptions.filter((p) => p.status === "issued").length,
      cancelledCount: prescriptions.filter((p) => p.status === "cancelled").length,
      itemsCount: allItems.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Escrita — criar prescrição
// ---------------------------------------------------------------------------

export async function createPrescription(
  attendanceId: string,
  input: CreatePrescriptionInput
): Promise<{ ok: true; prescriptionId: string } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const now = new Date()
  const status = input.issue ? "issued" : "draft"

  const prescription = await prisma.$transaction(async (tx) => {
    const created = await tx.prescription.create({
      data: {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        status,
        notes: input.notes,
        guidance: input.guidance,
        professionalName: input.professionalName,
        issuedAt: input.issue ? now : null,
        createdByName: input.professionalName,
        items: {
          create: input.items.map((item, index) => ({
            patientId: appointment.patientId,
            name: item.name,
            activeIngredient: item.activeIngredient,
            presentation: item.presentation,
            concentration: item.concentration,
            quantity: item.quantity,
            unit: item.unit,
            route: item.route,
            dose: item.dose,
            frequency: item.frequency,
            duration: item.duration,
            instructions: item.instructions,
            observations: item.observations,
            position: index,
          })),
        },
      },
      select: { id: true },
    })

    await tx.prescriptionLog.create({
      data: {
        prescriptionId: created.id,
        patientId: appointment.patientId,
        event: "created",
        label: `Prescrição criada (${input.items.length} ${
          input.items.length === 1 ? "item" : "itens"
        })`,
        performedByName: input.professionalName,
      },
    })

    if (input.issue) {
      await tx.prescriptionLog.create({
        data: {
          prescriptionId: created.id,
          patientId: appointment.patientId,
          event: "issued",
          label: "Prescrição emitida",
          performedByName: input.professionalName,
          createdAt: now,
        },
      })
    }

    return created
  })

  return { ok: true, prescriptionId: prescription.id }
}

// ---------------------------------------------------------------------------
// Escrita — atualizar prescrição (apenas rascunho)
// ---------------------------------------------------------------------------

export async function updatePrescription(
  attendanceId: string,
  prescriptionId: string,
  input: UpdatePrescriptionInput
): Promise<{ ok: true; prescriptionId: string } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const prescription = await prisma.prescription.findFirst({
    where: { id: prescriptionId, patientId: appointment.patientId },
    select: { id: true, status: true },
  })

  if (!prescription) {
    return {
      error: "Prescrição não encontrada para este paciente.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  // Prescrição emitida não é reescrita: para alterar, é preciso cancelar e
  // emitir uma nova (preservando o documento original).
  if (!canEditPrescription(prescription.status)) {
    return {
      error:
        "Uma prescrição emitida não pode ser alterada. Cancele-a e emita uma nova para preservar o histórico.",
      code: "PRESCRIPTION_LOCKED",
      status: 409,
    }
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.prescription.update({
      where: { id: prescription.id },
      data: {
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.guidance !== undefined ? { guidance: input.guidance } : {}),
        ...(input.professionalName !== undefined
          ? { professionalName: input.professionalName }
          : {}),
        ...(input.issue ? { status: "issued", issuedAt: now } : {}),
      },
    })

    // Substituição dos itens (somente em rascunho).
    if (input.items) {
      await tx.prescriptionItem.deleteMany({
        where: { prescriptionId: prescription.id },
      })
      await tx.prescriptionItem.createMany({
        data: input.items.map((item, index) => ({
          prescriptionId: prescription.id,
          patientId: appointment.patientId,
          name: item.name,
          activeIngredient: item.activeIngredient,
          presentation: item.presentation,
          concentration: item.concentration,
          quantity: item.quantity,
          unit: item.unit,
          route: item.route,
          dose: item.dose,
          frequency: item.frequency,
          duration: item.duration,
          instructions: item.instructions,
          observations: item.observations,
          position: index,
        })),
      })
    }

    await tx.prescriptionLog.create({
      data: {
        prescriptionId: prescription.id,
        patientId: appointment.patientId,
        event: input.issue ? "issued" : "updated",
        label: input.issue ? "Prescrição emitida" : "Prescrição atualizada",
        performedByName: input.professionalName ?? null,
        createdAt: now,
      },
    })
  })

  return { ok: true, prescriptionId: prescription.id }
}

// ---------------------------------------------------------------------------
// Escrita — cancelar prescrição (registro preservado)
// ---------------------------------------------------------------------------

export async function cancelPrescription(
  attendanceId: string,
  prescriptionId: string,
  input: CancelPrescriptionInput
): Promise<{ ok: true; prescriptionId: string } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const prescription = await prisma.prescription.findFirst({
    where: { id: prescriptionId, patientId: appointment.patientId },
    select: { id: true, status: true },
  })

  if (!prescription) {
    return {
      error: "Prescrição não encontrada para este paciente.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  if (!canCancelPrescription(prescription.status)) {
    return {
      error: "Esta prescrição já está cancelada.",
      code: "ALREADY_CANCELLED",
      status: 409,
    }
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.prescription.update({
      where: { id: prescription.id },
      data: {
        status: "cancelled",
        cancelledAt: now,
        cancelReason: input.reason,
        cancelledByName: input.cancelledByName,
      },
    })

    await tx.prescriptionLog.create({
      data: {
        prescriptionId: prescription.id,
        patientId: appointment.patientId,
        event: "cancelled",
        label: "Prescrição cancelada",
        notes: input.reason,
        performedByName: input.cancelledByName,
        createdAt: now,
      },
    })
  })

  return { ok: true, prescriptionId: prescription.id }
}

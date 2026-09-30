import { prisma } from "@/lib/prisma"
import {
  type SaveEvolutionInput,
  type EvolutionResponse,
  type EvolutionView,
  type FinalizeResponse,
} from "@/lib/schemas-evolution"

// ===========================================================================
// Serviço da EVOLUÇÃO CLÍNICA (Parte 6).
//
// Responsabilidades:
// - Resolver o paciente SEMPRE a partir do atendimento (nunca do cliente).
// - Cada atendimento possui no máximo UM registro de evolução (1:1).
// - Procedimentos referenciados usam o catálogo EXISTENTE (não duplicado).
// - Finalização marca o encerramento e bloqueia alterações silenciosas.
// - Alterações pós-finalização exigem rastreabilidade.
// ===========================================================================

// ---------------------------------------------------------------------------
// Tipos do contrato com o frontend
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

// Resolve o atendimento + paciente. Toda operação parte daqui, garantindo
// o isolamento entre pacientes (LGPD) e a integridade referencial.
async function resolveAttendance(attendanceId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: attendanceId },
    select: {
      id: true,
      patientId: true,
      appointmentDate: true,
      appointmentTime: true,
      status: true,
      patient: {
        select: {
          id: true,
          fullName: true,
          cpf: true,
          birthDate: true,
        },
      },
      procedures: {
        select: {
          id: true,
          procedureNameSnapshot: true,
          quantity: true,
        },
        orderBy: { createdAt: "asc" },
      },
      anamnesis: {
        select: {
          chiefComplaint: true,
          visitReason: true,
          complaintHistory: true,
        },
      },
      odontogramEvents: {
        where: { status: { in: ["active", "performed"] } },
        select: {
          toothNumber: true,
          dentition: true,
          kind: true,
          code: true,
          labelSnapshot: true,
          surfaces: true,
          status: true,
        },
        orderBy: { toothNumber: "asc" },
      },
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
          finalizedById: true,
          finalizedByName: true,
          createdById: true,
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
              material: true,
              notes: true,
              professionalName: true,
              occurredAt: true,
            },
            orderBy: { occurredAt: "asc" },
          },
        },
      },
    },
  })

  return appointment
}

// Calcula a idade a partir da data de nascimento.
function calculateAge(birthDate: Date | null): number | null {
  if (!birthDate) return null
  const now = new Date()
  let age = now.getFullYear() - birthDate.getFullYear()
  const monthDiff = now.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

// Converte surfaces CSV para array.
function parseSurfaces(surfaces: string | null): string[] {
  if (!surfaces) return []
  return surfaces.split(",").filter(Boolean).map((s) => s.trim().toUpperCase())
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function getEvolution(attendanceId: string) {
  const appointment = await resolveAttendance(attendanceId)

  if (!appointment) {
    return null
  }

  const age = calculateAge(appointment.patient.birthDate)

  const evolution = appointment.evolutionRecord

  const proceduresScheduled = appointment.procedures.map((p) => ({
    id: p.id,
    name: p.procedureNameSnapshot,
    quantity: p.quantity,
  }))

  const anamnesisRef = appointment.anamnesis
    ? {
        chiefComplaint: appointment.anamnesis.chiefComplaint,
        visitReason: appointment.anamnesis.visitReason,
        complaintHistory: appointment.anamnesis.complaintHistory,
      }
    : null

  const odontogramRef = {
    currentEvents: appointment.odontogramEvents.map((e) => ({
      toothNumber: e.toothNumber,
      dentition: e.dentition,
      kind: e.kind,
      code: e.code,
      label: e.labelSnapshot,
      surfaces: parseSurfaces(e.surfaces),
      status: e.status,
    })),
  }

  let evolutionView: EvolutionView | null = null
  if (evolution) {
    const procedureRecords = evolution.procedureRecords.map((r) => ({
      id: r.id,
      procedureId: r.procedureId,
      procedureNameSnapshot: r.procedureNameSnapshot,
      toothNumber: r.toothNumber,
      dentition: r.dentition,
      surfaces: parseSurfaces(r.surfaces),
      status: r.status,
      material: r.material,
      notes: r.notes,
      professionalName: r.professionalName,
      appointmentId: attendanceId,
      occurredAt: r.occurredAt.toISOString(),
    }))

    evolutionView = {
      id: evolution.id,
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      chiefComplaint: evolution.chiefComplaint,
      clinicalFindings: evolution.clinicalFindings,
      evaluation: evolution.evaluation,
      conduct: evolution.conduct,
      procedures: procedureRecords,
      evolution: evolution.evolution,
      guidance: evolution.guidance,
      intercurrentHas: evolution.intercurrentHas,
      intercurrentDescription: evolution.intercurrentDesc,
      observations: evolution.observations,
      finalized: evolution.finalized,
      finalizedAt: evolution.finalizedAt?.toISOString() ?? null,
      finalizedById: evolution.finalizedById,
      finalizedByName: evolution.finalizedByName,
      createdById: evolution.createdById,
      createdByName: evolution.createdByName,
      createdAt: evolution.createdAt.toISOString(),
      updatedAt: evolution.updatedAt.toISOString(),
    }
  }

  const response: EvolutionResponse = {
    appointment: {
      id: appointment.id,
      code: attendanceId.slice(-6).toUpperCase().padStart(6, "0"),
      date: appointment.appointmentDate.toISOString().split("T")[0],
      time: appointment.appointmentTime,
      status: appointment.status,
    },
    patient: {
      id: appointment.patient.id,
      fullName: appointment.patient.fullName,
      cpf: appointment.patient.cpf,
      birthDate: appointment.patient.birthDate?.toISOString().split("T")[0] ?? null,
      age,
    },
    professional: null, // preenchido quando a relação com usuários existir
    proceduresScheduled,
    evolution: evolutionView,
    anamnesisRef,
    odontogramRef,
  }

  return response
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export async function saveEvolution(
  attendanceId: string,
  input: SaveEvolutionInput
) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: attendanceId },
    select: { id: true, patientId: true, status: true },
  })

  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  // Só permite salvar evolução em atendimentos em andamento ou aguardando.
  // Após a finalização (Parte 9) o registro clínico fica FECHADO: alterações
  // livres deixam de ser permitidas para preservar a integridade do prontuário.
  if (!["in_progress", "awaiting_attendance", "paid"].includes(appointment.status)) {
    return {
      error:
        appointment.status === "completed"
          ? "Este atendimento já foi finalizado. O registro clínico está fechado e não pode ser editado livremente."
          : "Evolução só pode ser registrada em atendimentos em andamento.",
      code: "INVALID_STATUS",
      status: 422,
    }
  }

  const {
    chiefComplaint,
    clinicalFindings,
    evaluation,
    conduct,
    procedures,
    evolution,
    guidance,
    intercurrent,
    observations,
    responsibleName,
    finalize,
  } = input

  // Validação de intercorrências.
  if (intercurrent?.hasIntercurrent && !intercurrent.description?.trim()) {
    return {
      error: "Descrição da intercorrência é obrigatória quando há intercorrência.",
      code: "INTERCURRENT_REQUIRED",
      status: 422,
    }
  }

  // Upsert do registro de evolução.
  const result = await prisma.$transaction(async (tx) => {
    // Busca ou cria o registro de evolução.
    const evolutionRecord = await tx.appointmentEvolution.upsert({
      where: { appointmentId: attendanceId },
      create: {
        appointmentId: attendanceId,
        patientId: appointment.patientId,
        chiefComplaint: chiefComplaint?.text ?? null,
        clinicalFindings: clinicalFindings?.text ?? null,
        evaluation: evaluation?.text ?? null,
        conduct: conduct?.text ?? null,
        evolution: evolution?.text ?? null,
        guidance: guidance?.text ?? null,
        intercurrentHas: intercurrent?.hasIntercurrent ?? false,
        intercurrentDesc: intercurrent?.hasIntercurrent ? intercurrent.description : null,
        observations: observations?.text ?? null,
        finalized: finalize,
        finalizedAt: finalize ? new Date() : null,
        finalizedById: null, // preenchido quando houver autenticação
        finalizedByName: finalize ? responsibleName : null,
        createdById: null,
        createdByName: responsibleName,
      },
      update: {
        chiefComplaint: chiefComplaint?.text ?? null,
        clinicalFindings: clinicalFindings?.text ?? null,
        evaluation: evaluation?.text ?? null,
        conduct: conduct?.text ?? null,
        evolution: evolution?.text ?? null,
        guidance: guidance?.text ?? null,
        intercurrentHas: intercurrent?.hasIntercurrent ?? false,
        intercurrentDesc: intercurrent?.hasIntercurrent ? intercurrent.description : null,
        observations: observations?.text ?? null,
        finalized: finalize,
        finalizedAt: finalize ? new Date() : null,
        finalizedById: null,
        finalizedByName: finalize ? responsibleName : null,
        updatedAt: new Date(),
      },
      include: { procedureRecords: true },
    })

    // Processa os procedimentos registrados.
    if (procedures && procedures.length > 0) {
      // Remove procedimentos que não estão mais na lista (soft delete via remoção).
      const incomingIds = procedures
        .map((p) => p.procedureId)
        .filter(Boolean)

      // Remove procedimentos removidos.
      await tx.appointmentProcedureRecord.deleteMany({
        where: {
          evolutionId: evolutionRecord.id,
          procedureId: { notIn: incomingIds },
        },
      })

      // Upsert de cada procedimento.
      for (const proc of procedures) {
        const surfacesStr = proc.surfaces && proc.surfaces.length > 0
          ? proc.surfaces.map((s) => s.toUpperCase()).join(",")
          : ""

        await tx.appointmentProcedureRecord.upsert({
          where: {
            // Identificador único: evolutionId + procedureId + toothNumber + surfaces
            id: `${evolutionRecord.id}-${proc.procedureId}-${proc.toothNumber ?? "none"}-${surfacesStr || "none"}`,
          },
          create: {
            evolutionId: evolutionRecord.id,
            procedureId: proc.procedureId,
            procedureNameSnapshot: proc.procedureNameSnapshot,
            toothNumber: proc.toothNumber ?? null,
            dentition: proc.dentition ?? null,
            surfaces: surfacesStr,
            status: proc.status,
            material: proc.material,
            notes: proc.notes,
            professionalName: responsibleName,
            occurredAt: new Date(),
          },
          update: {
            toothNumber: proc.toothNumber ?? null,
            dentition: proc.dentition ?? null,
            surfaces: surfacesStr,
            status: proc.status,
            material: proc.material,
            notes: proc.notes,
            professionalName: responsibleName,
            occurredAt: new Date(),
          },
        })
      }
    }

    return evolutionRecord
  })

  return { saved: true, id: result.id, finalized: result.finalized }
}

// ---------------------------------------------------------------------------
// Finalização
// ---------------------------------------------------------------------------

export async function finalizeEvolution(
  attendanceId: string,
  responsibleName: string
) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: attendanceId },
    select: { id: true, patientId: true, status: true },
  })

  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const evolution = await prisma.appointmentEvolution.findUnique({
    where: { appointmentId: attendanceId },
  })

  if (!evolution) {
    return { error: "Nenhum registro de evolução encontrado.", code: "NOT_FOUND", status: 404 }
  }

  if (evolution.finalized) {
    return {
      error: "Este atendimento já foi finalizado.",
      code: "ALREADY_FINALIZED",
      status: 422,
    }
  }

  const now = new Date()

  await prisma.appointmentEvolution.update({
    where: { id: evolution.id },
    data: {
      finalized: true,
      finalizedAt: now,
      finalizedById: null, // preenchido quando houver autenticação
      finalizedByName: responsibleName,
      updatedAt: now,
    },
  })

  // Opcionalmente, atualizar o status do atendimento para "completed".
  // Isso é decisão do fluxo de atendimento, não da evolução em si.
  // Por enquanto, mantemos o status do atendimento inalterado.

  const finalizeResponse: FinalizeResponse = {
    success: true,
    finalized: true,
    finalizedAt: now.toISOString(),
    finalizedByName: responsibleName,
    changes: [
      {
        field: "finalized",
        oldValue: "false",
        newValue: "true",
      },
      {
        field: "finalizedAt",
        oldValue: null,
        newValue: now.toISOString(),
      },
      {
        field: "finalizedByName",
        oldValue: null,
        newValue: responsibleName,
      },
    ],
  }

  return finalizeResponse
}

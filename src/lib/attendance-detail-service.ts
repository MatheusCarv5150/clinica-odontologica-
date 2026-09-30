// ===========================================================================
// Serviço de LEITURA do atendimento completo — módulo Atendimento (Parte 8).
// ===========================================================================
//
// Usado pelo "Ver atendimento completo" da EVOLUÇÃO. Diferente da tela de
// atendimento em andamento (que é editável), aqui o objetivo é CONSULTAR um
// atendimento — normalmente ANTIGO — em modo SOMENTE LEITURA.
//
// REGRAS DE SEGURANÇA (LGPD / isolamento entre pacientes):
//   - O atendimento-alvo é validado como pertencente ao MESMO paciente do
//     atendimento aberto. Um ID de atendimento de outro paciente retorna 404
//     (não confirmamos a existência de registros alheios).
//   - O retorno é sempre marcado como `readOnly` quando o atendimento não está
//     em andamento, deixando explícito que a interface não deve permitir
//     alteração silenciosa de registros antigos.
//
// Este serviço NÃO grava nada: é uma projeção de consulta. A auditoria dos
// registros permanece nas trilhas já existentes (change logs das partes 4/7
// e o carimbo de criação/atualização do registro clínico da Parte 6).

import { prisma } from "@/lib/prisma"
import { normalizeTime } from "@/lib/date-utils"
import { buildFriendlyCode } from "@/lib/attendance-status"
import { formatSurfaceList } from "@/lib/evolution-timeline"

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export interface AttendanceDetailResponse {
  attendance: {
    id: string
    code: string
    date: string
    time: string | null
    status: string
    isCurrent: boolean
    readOnly: boolean
  }
  patient: {
    id: string
    fullName: string
    cpf: string
    birthDate: string | null
    age: number | null
  }
  professional: { id: string; name: string } | null

  // Anamnese do atendimento (Parte 4) — queixa e informações do momento.
  anamnesis: {
    chiefComplaint: string | null
    visitReason: string | null
    complaintHistory: string | null
    complaintIntensity: string | null
    associatedSymptoms: string | null
    anxietyLevel: string | null
    anxietyNotes: string | null
    notes: string | null
  } | null

  // Registro clínico do atendimento (Parte 6).
  evolution: {
    id: string
    chiefComplaint: string | null
    clinicalFindings: string | null
    evaluation: string | null
    conduct: string | null
    evolution: string | null
    guidance: string | null
    intercurrentHas: boolean
    intercurrentDescription: string | null
    observations: string | null
    finalized: boolean
    finalizedAt: string | null
    finalizedByName: string | null
    createdByName: string | null
    createdAt: string
    updatedAt: string
    procedures: Array<{
      id: string
      procedureId: string
      name: string
      toothNumber: string | null
      surfaces: string[]
      surfacesLabel: string
      status: string
      material: string | null
      notes: string | null
      professionalName: string | null
    }>
  } | null

  // Procedimentos do atendimento (Parte 7): previsto x realizado.
  procedures: {
    scheduled: Array<{
      id: string
      name: string
      quantity: number
      unitPrice: number
      totalPrice: number
    }>
    executions: Array<{
      id: string
      procedureId: string
      name: string
      origin: string
      status: string
      toothNumber: string | null
      surfaces: string[]
      surfacesLabel: string
      performedPrice: number | null
      notes: string | null
      professionalName: string | null
    }>
  }

  // Eventos do odontograma registrados NESTE atendimento (Parte 5).
  odontogram: {
    events: Array<{
      id: string
      toothNumber: string
      dentition: string
      kind: string
      code: string
      label: string
      surfaces: string[]
      surfacesLabel: string
      status: string
      notes: string | null
    }>
  }

  // Carimbos de auditoria (data do atendimento ≠ data do registro).
  audit: {
    recordCreatedAt: string | null
    recordUpdatedAt: string | null
    attendanceCreatedAt: string
    attendanceUpdatedAt: string
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

// Resolve um atendimento do MESMO paciente do atendimento de referência.
async function resolveOwnedAppointment(
  referenceId: string,
  targetId: string
): Promise<{ referencePatientId: string; targetId: string } | "not_found"> {
  const reference = await prisma.appointment.findUnique({
    where: { id: referenceId },
    select: { patientId: true },
  })
  if (!reference) return "not_found"

  const target = await prisma.appointment.findUnique({
    where: { id: targetId },
    select: { id: true, patientId: true },
  })
  if (!target || target.patientId !== reference.patientId) return "not_found"

  return { referencePatientId: reference.patientId, targetId: target.id }
}

export async function getAttendanceDetail(
  referenceAttendanceId: string,
  targetAttendanceId: string
): Promise<AttendanceDetailResponse | "not_found"> {
  const owned = await resolveOwnedAppointment(
    referenceAttendanceId,
    targetAttendanceId
  )
  if (owned === "not_found") return "not_found"

  const appointment = await prisma.appointment.findUnique({
    where: { id: owned.targetId },
    select: {
      id: true,
      appointmentDate: true,
      appointmentTime: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      patient: {
        select: { id: true, fullName: true, cpf: true, birthDate: true },
      },
      anamnesis: {
        select: {
          chiefComplaint: true,
          visitReason: true,
          complaintHistory: true,
          complaintIntensity: true,
          associatedSymptoms: true,
          anxietyLevel: true,
          anxietyNotes: true,
          notes: true,
        },
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
              surfaces: true,
              status: true,
              material: true,
              notes: true,
              professionalName: true,
            },
          },
        },
      },
      procedureExecutions: {
        select: {
          id: true,
          procedureId: true,
          procedureNameSnapshot: true,
          origin: true,
          status: true,
          toothNumber: true,
          surfaces: true,
          performedPrice: true,
          notes: true,
          professionalName: true,
        },
      },
      procedures: {
        select: {
          id: true,
          procedureNameSnapshot: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
        },
        orderBy: { createdAt: "asc" },
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
          notes: true,
        },
        orderBy: [{ toothNumber: "asc" }, { occurredAt: "asc" }],
      },
    },
  })

  if (!appointment) return "not_found"

  const isCurrent = appointment.id === referenceAttendanceId
  // Um atendimento antigo é SEMPRE somente leitura. Apenas o atendimento
  // atualmente em andamento é editável (nas outras áreas do prontuário).
  const readOnly = !(isCurrent && appointment.status === "in_progress")

  const professionalName =
    appointment.evolutionRecord?.finalizedByName?.trim() ||
    appointment.evolutionRecord?.createdByName?.trim() ||
    appointment.procedureExecutions.find((e) => e.professionalName)?.professionalName ||
    null

  return {
    attendance: {
      id: appointment.id,
      code: buildFriendlyCode(appointment.id),
      date: appointment.appointmentDate.toISOString(),
      time: normalizeTime(appointment.appointmentTime),
      status: appointment.status,
      isCurrent,
      readOnly,
    },
    patient: {
      id: appointment.patient.id,
      fullName: appointment.patient.fullName,
      cpf: appointment.patient.cpf,
      birthDate: appointment.patient.birthDate?.toISOString() ?? null,
      age: calculateAge(appointment.patient.birthDate),
    },
    professional: professionalName
      ? { id: professionalName, name: professionalName }
      : null,
    anamnesis: appointment.anamnesis
      ? {
          chiefComplaint: appointment.anamnesis.chiefComplaint,
          visitReason: appointment.anamnesis.visitReason,
          complaintHistory: appointment.anamnesis.complaintHistory,
          complaintIntensity: appointment.anamnesis.complaintIntensity,
          associatedSymptoms: appointment.anamnesis.associatedSymptoms,
          anxietyLevel: appointment.anamnesis.anxietyLevel,
          anxietyNotes: appointment.anamnesis.anxietyNotes,
          notes: appointment.anamnesis.notes,
        }
      : null,
    evolution: appointment.evolutionRecord
      ? {
          id: appointment.evolutionRecord.id,
          chiefComplaint: appointment.evolutionRecord.chiefComplaint,
          clinicalFindings: appointment.evolutionRecord.clinicalFindings,
          evaluation: appointment.evolutionRecord.evaluation,
          conduct: appointment.evolutionRecord.conduct,
          evolution: appointment.evolutionRecord.evolution,
          guidance: appointment.evolutionRecord.guidance,
          intercurrentHas: appointment.evolutionRecord.intercurrentHas,
          intercurrentDescription: appointment.evolutionRecord.intercurrentDesc,
          observations: appointment.evolutionRecord.observations,
          finalized: appointment.evolutionRecord.finalized,
          finalizedAt:
            appointment.evolutionRecord.finalizedAt?.toISOString() ?? null,
          finalizedByName: appointment.evolutionRecord.finalizedByName,
          createdByName: appointment.evolutionRecord.createdByName,
          createdAt: appointment.evolutionRecord.createdAt.toISOString(),
          updatedAt: appointment.evolutionRecord.updatedAt.toISOString(),
          procedures: appointment.evolutionRecord.procedureRecords.map((item) => ({
            id: item.id,
            procedureId: item.procedureId,
            name: item.procedureNameSnapshot,
            toothNumber: item.toothNumber,
            surfaces: item.surfaces ? item.surfaces.split(",").filter(Boolean) : [],
            surfacesLabel: formatSurfaceList(item.surfaces),
            status: item.status,
            material: item.material,
            notes: item.notes,
            professionalName: item.professionalName,
          })),
        }
      : null,
    procedures: {
      scheduled: appointment.procedures.map((p) => ({
        id: p.id,
        name: p.procedureNameSnapshot,
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        totalPrice: p.totalPrice,
      })),
      executions: appointment.procedureExecutions.map((execution) => ({
        id: execution.id,
        procedureId: execution.procedureId,
        name: execution.procedureNameSnapshot,
        origin: execution.origin,
        status: execution.status,
        toothNumber: execution.toothNumber,
        surfaces: execution.surfaces
          ? execution.surfaces.split(",").filter(Boolean)
          : [],
        surfacesLabel: formatSurfaceList(execution.surfaces),
        performedPrice: execution.performedPrice,
        notes: execution.notes,
        professionalName: execution.professionalName,
      })),
    },
    odontogram: {
      events: appointment.odontogramEvents.map((event) => ({
        id: event.id,
        toothNumber: event.toothNumber,
        dentition: event.dentition,
        kind: event.kind,
        code: event.code,
        label: event.labelSnapshot,
        surfaces: event.surfaces
          ? event.surfaces.split(",").filter(Boolean)
          : [],
        surfacesLabel: formatSurfaceList(event.surfaces),
        status: event.status,
        notes: event.notes,
      })),
    },
    audit: {
      recordCreatedAt:
        appointment.evolutionRecord?.createdAt.toISOString() ?? null,
      recordUpdatedAt:
        appointment.evolutionRecord?.updatedAt.toISOString() ?? null,
      attendanceCreatedAt: appointment.createdAt.toISOString(),
      attendanceUpdatedAt: appointment.updatedAt.toISOString(),
    },
  }
}

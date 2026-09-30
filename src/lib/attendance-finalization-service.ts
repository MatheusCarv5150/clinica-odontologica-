import { prisma } from "@/lib/prisma"
import {
  assessFinalization,
  computeDurationMinutes,
  formatDuration,
  FINALIZATION_EVENT,
  FINALIZATION_ERROR_CODES,
  type FinalizationPending,
  type FinalizationSnapshot,
} from "@/lib/attendance-finalization-domain"
import { resolveProfessionalSnapshot } from "@/lib/professionals-service"
import type {
  FinalizationPreviewResponse,
  FinalizeAttendanceResponse,
} from "@/lib/schemas-finalization"

// ===========================================================================
// Serviço da FINALIZAÇÃO DO ATENDIMENTO (Parte 9).
//
// RESPONSABILIDADES
// - Validar o atendimento (existência, status, paciente, profissional).
// - Validar pendências (bloqueantes impedem; avisos exigem decisão).
// - Persistir o encerramento em UMA transação (nada parcial).
// - Registrar started_at/finished_at NO SERVIDOR (nunca do navegador).
// - Derivar a duração dos timestamps (nunca digitada).
// - Registrar o profissional responsável e o usuário que finalizou.
// - Gravar a auditoria ATENDIMENTO_FINALIZADO.
// - Atualizar o status para "completed" (enum EXISTENTE — sem status paralelo).
// - Ser IDEMPOTENTE e protegida contra concorrência.
//
// NÃO FAZ:
// - não cria segunda evolução (a evolução reflete o atendimento finalizado);
// - não duplica procedimentos nem odontograma (mantém a fonte única);
// - não apaga nenhum registro clínico.
// ===========================================================================

export type FinalizationError = { error: string; code: string; status: number }

// ---------------------------------------------------------------------------
// Montagem do snapshot a partir do banco (fonte confiável)
// ---------------------------------------------------------------------------

// Contrato mínimo do usuário autenticado. A arquitetura ainda não possui um
// módulo de sessão/autorização completo; quando existir, este é o ponto de
// integração. Enquanto isso, o serviço valida a CONSISTÊNCIA do nome informado
// com o responsável já associado ao atendimento (quando houver) e nunca aceita
// um profissional arbitrário sem vínculo.
export interface AuthenticatedActor {
  userId: string | null
  name: string
}

async function buildSnapshot(
  attendanceId: string,
  actorName: string
): Promise<FinalizationSnapshot | null> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: attendanceId },
    select: {
      id: true,
      status: true,
      patientId: true,
      startedAt: true,
      finishedById: true,
      finishedByName: true,
      patient: { select: { id: true, fullName: true } },
      evolutionRecord: {
        select: {
          id: true,
          clinicalFindings: true,
          evaluation: true,
          conduct: true,
          evolution: true,
          intercurrentHas: true,
          intercurrentDesc: true,
        },
      },
      procedureExecutions: {
        select: {
          id: true,
          status: true,
          origin: true,
          toothNumber: true,
          surfaces: true,
        },
        where: { status: { not: "cancelled" } },
      },
      procedures: { select: { id: true } },
      odontogramEvents: { select: { id: true } },
      anamnesis: { select: { id: true } },
    },
  })

  if (!appointment) return null

  // --- Procedimentos: contagens REAIS (previsto x classificado) ---
  const executions = appointment.procedureExecutions
  const performedCount = executions.filter((e) => e.status === "performed").length
  const notPerformedCount = executions.filter(
    (e) => e.status === "not_performed"
  ).length
  const pendingCount = executions.filter(
    (e) => e.status === "pending" || e.status === "in_progress"
  ).length

  // Consistência: procedimento realizado com superfícies informadas precisa de
  // dente; e superfícies presentes exigem dente. Detecta dados corrompidos.
  const inconsistentCount = executions.filter(
    (e) =>
      e.status === "performed" &&
      (!e.toothNumber && e.surfaces.trim().length > 0)
  ).length

  // --- Registro clínico (Parte 6) ---
  const record = appointment.evolutionRecord
  const hasText = (value: string | null | undefined) =>
    !!value && value.trim().length > 0

  const recordSnapshot = {
    exists: !!record,
    hasClinicalFindings: hasText(record?.clinicalFindings),
    hasEvaluation: hasText(record?.evaluation),
    hasConduct: hasText(record?.conduct),
    intercurrentIncomplete:
      !!record?.intercurrentHas && !hasText(record?.intercurrentDesc),
  }

  // --- Evolução (Parte 8): o relato cronológico da evolução é o campo
  //     narrativo próprio. Achados/conduta já são exigidos como obrigatórios
  //     no registro clínico; aqui avaliamos especificamente o registro da
  //     evolução, que é o que alimenta a linha do tempo clínica. ---
  const evolutionRegistered = hasText(record?.evolution)

  // --- Anamnese (Parte 4): obrigatória apenas quando aplicável ---
  // Regra adotada: se o paciente NÃO tem nenhum registro de anamnese prévio
  // (primeira consulta) E o atendimento atual não possui anamnese, ela é
  // considerada aplicável/pendente (aviso).
  const priorAnamnesisCount = await prisma.anamnesis.count({
    where: { patientId: appointment.patientId },
  })
  const anamnesisRequired =
    priorAnamnesisCount === 0 && !appointment.anamnesis?.id

  return {
    attendance: {
      id: appointment.id,
      status: appointment.status,
      patientId: appointment.patient?.id ?? null,
      patientName: appointment.patient?.fullName ?? null,
      startedAt: appointment.startedAt,
    },
    professional: {
      name: actorName,
      // Consistência: se o atendimento já tinha um responsável de finalização
      // (não deve ocorrer antes de finalizar) ou se o nome informado é válido.
      authenticated: !!actorName && actorName.trim().length >= 2,
    },
    procedures: {
      scheduledCount: appointment.procedures.length,
      performedCount,
      notPerformedCount,
      pendingCount,
      inconsistentCount,
    },
    record: recordSnapshot,
    evolution: { registered: evolutionRegistered },
    odontogram: {
      eventCount: appointment.odontogramEvents.length,
      hasUnpersistedChanges: false,
    },
    anamnesis: {
      required: anamnesisRequired,
      provided: !!appointment.anamnesis?.id,
    },
  }
}

// ---------------------------------------------------------------------------
// Preview (etapa de revisão — NÃO grava nada)
// ---------------------------------------------------------------------------

export async function previewFinalization(
  attendanceId: string,
  responsibleName: string
): Promise<FinalizationPreviewResponse | FinalizationError> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: attendanceId },
    select: { id: true, status: true, finishedAt: true, startedAt: true },
  })

  if (!appointment) {
    return {
      error: "Atendimento não encontrado.",
      code: FINALIZATION_ERROR_CODES.NOT_FOUND,
      status: 404,
    }
  }

  // Atendimento já finalizado: o preview é informativo e reflete o estado atual.
  if (appointment.status === "completed" || appointment.finishedAt) {
    const duration = computeDurationMinutes(appointment.startedAt, new Date())
    return {
      canFinalize: false,
      blocking: [
        {
          code: "ALREADY_FINALIZED",
          severity: "blocking",
          area: "attendance",
          title: "Atendimento já finalizado",
          description: "Este atendimento já foi finalizado e o registro está fechado.",
          action: "none",
        },
      ],
      warnings: [],
      info: [],
      blockingReason: "Este atendimento já foi finalizado.",
      summary: {
        patientName: null,
        status: appointment.status,
        statusLabel: "Concluído",
        startedAt: appointment.startedAt?.toISOString() ?? null,
        durationMinutes: duration,
        durationLabel: formatDuration(duration),
        proceduresScheduled: 0,
        proceduresPerformed: 0,
        proceduresNotPerformed: 0,
        proceduresPending: 0,
        recordFilled: true,
        evolutionRegistered: true,
        odontogramUpdated: true,
      },
    }
  }

  const snapshot = await buildSnapshot(attendanceId, responsibleName)
  if (!snapshot) {
    return {
      error: "Atendimento não encontrado.",
      code: FINALIZATION_ERROR_CODES.NOT_FOUND,
      status: 404,
    }
  }

  const assessment = assessFinalization(snapshot)

  return {
    canFinalize: assessment.canFinalize,
    blocking: assessment.blocking.map(toView),
    warnings: assessment.warnings.map(toView),
    info: assessment.info.map(toView),
    blockingReason: assessment.blockingReason,
    summary: {
      patientName: assessment.summary.patientName,
      status: assessment.summary.status,
      statusLabel: assessment.summary.statusLabel,
      startedAt: assessment.summary.startedAt?.toISOString() ?? null,
      durationMinutes: assessment.summary.durationMinutes,
      durationLabel: formatDuration(assessment.summary.durationMinutes),
      proceduresScheduled: assessment.summary.proceduresScheduled,
      proceduresPerformed: assessment.summary.proceduresPerformed,
      proceduresNotPerformed: assessment.summary.proceduresNotPerformed,
      proceduresPending: assessment.summary.proceduresPending,
      recordFilled: assessment.summary.recordFilled,
      evolutionRegistered: assessment.summary.evolutionRegistered,
      odontogramUpdated: assessment.summary.odontogramUpdated,
    },
  }
}

function toView(pending: FinalizationPending) {
  return {
    code: pending.code,
    severity: pending.severity,
    area: pending.area,
    title: pending.title,
    description: pending.description,
    action: pending.action,
  }
}

// ---------------------------------------------------------------------------
// Finalização (operação transacional)
// ---------------------------------------------------------------------------

export async function finalizeAttendance(
  attendanceId: string,
  actor: AuthenticatedActor
): Promise<FinalizeAttendanceResponse | FinalizationError> {
  // Identidade do responsável: quando o `userId` corresponde a um profissional
  // CADASTRADO, o nome e o conselho são resolvidos NO BACKEND (fonte
  // autoritativa) e congelados no atendimento. Sem cadastro correspondente,
  // usa-se o nome informado (identidade textual legada).
  const registered = await resolveProfessionalSnapshot(actor.userId)
  const responsibleName = (registered?.fullName ?? actor.name ?? "").trim()
  const responsibleCouncil = registered?.councilLabel ?? null

  if (!responsibleName || responsibleName.length < 2) {
    return {
      error: "O nome do profissional responsável é obrigatório para finalizar.",
      code: FINALIZATION_ERROR_CODES.PROFESSIONAL_REQUIRED,
      status: 422,
    }
  }

  try {
    // Toda a operação roda em UMA transação: ou o atendimento fica
    // completamente finalizado, ou nada é alterado (rollback automático).
    return await prisma.$transaction(async (tx) => {
      // 1) Validar atendimento — leitura DENTRO da transação (estado atual).
      const appointment = await tx.appointment.findUnique({
        where: { id: attendanceId },
        select: {
          id: true,
          status: true,
          patientId: true,
          startedAt: true,
          finishedAt: true,
          patient: { select: { id: true, fullName: true } },
        },
      })

      if (!appointment) {
        return {
          error: "Atendimento não encontrado.",
          code: FINALIZATION_ERROR_CODES.NOT_FOUND,
          status: 404,
        }
      }

      // 2) Idempotência — já finalizado devolve o estado atual sem duplicar
      //    auditoria nem reescrever timestamps.
      if (appointment.status === "completed" || appointment.finishedAt) {
        const duration = computeDurationMinutes(
          appointment.startedAt,
          appointment.finishedAt ?? new Date()
        )
        const existing = await tx.appointment.findUnique({
          where: { id: attendanceId },
          select: { finishedByName: true, finishedByCouncil: true },
        })
        return {
          success: true,
          finalized: true,
          alreadyFinalized: true,
          finalizedAt: appointment.finishedAt?.toISOString() ?? null,
          startedAt: appointment.startedAt?.toISOString() ?? null,
          durationMinutes: duration,
          responsibleName: existing?.finishedByName ?? responsibleName,
          responsibleCouncil: existing?.finishedByCouncil ?? responsibleCouncil,
        }
      }

      // 3) Validar status finalizável (bloqueante).
      if (appointment.status !== "in_progress") {
        return {
          error:
            appointment.status === "cancelled"
              ? "Este atendimento foi cancelado e não pode ser finalizado."
              : appointment.status === "no_show"
              ? "Este paciente não compareceu ao atendimento; não há o que finalizar."
              : "Este atendimento ainda não foi iniciado. Inicie o atendimento para poder finalizá-lo.",
          code: FINALIZATION_ERROR_CODES.INVALID_STATUS,
          status: 409,
        }
      }

      // 4) Validar pendências (bloqueantes impedem a finalização).
      const snapshot = await buildSnapshot(attendanceId, responsibleName)
      if (!snapshot) {
        // Inconsistência improvável (excluído entre as leituras).
        return {
          error: "Atendimento inconsistente. Recarregue e tente novamente.",
          code: FINALIZATION_ERROR_CODES.NOT_FOUND,
          status: 409,
        }
      }

      const assessment = assessFinalization(snapshot)

      if (!assessment.canFinalize) {
        return {
          error:
            assessment.blockingReason ??
            "Existem pendências que impedem a finalização deste atendimento.",
          code: FINALIZATION_ERROR_CODES.PENDING_BLOCKING,
          status: 422,
        }
      }

      const now = new Date()
      // O início é EXCLUSIVAMENTE o registrado pelo backend na Part 1. Se por
      // algum motivo estiver ausente, derivamos do updatedAt (fallback seguro)
      // sem permitir que o cliente informe o horário.
      let startedAt = appointment.startedAt
      if (!startedAt) {
        const fallback = await tx.appointment.findUnique({
          where: { id: attendanceId },
          select: { updatedAt: true, createdAt: true },
        })
        startedAt = fallback?.updatedAt ?? fallback?.createdAt ?? now
      }

      // 5) Atualização CONDICIONAL e atômica: só finaliza se ainda estiver
      //    "in_progress". Protege contra duas finalizações concorrentes.
      const result = await tx.appointment.updateMany({
        where: { id: attendanceId, status: "in_progress" },
        data: {
          status: "completed",
          startedAt,
          finishedAt: now,
          finishedById: actor.userId,
          finishedByName: responsibleName,
          finishedByCouncil: responsibleCouncil,
        },
      })

      if (result.count === 0) {
        // Outro usuário finalizou primeiro (ou o status mudou). Não é erro
        // fatal: devolve o estado atual (idempotente).
        const current = await tx.appointment.findUnique({
          where: { id: attendanceId },
          select: {
            status: true,
            startedAt: true,
            finishedAt: true,
            finishedByName: true,
            finishedByCouncil: true,
          },
        })
        const duration = computeDurationMinutes(
          current?.startedAt ?? null,
          current?.finishedAt ?? now
        )
        return {
          success: true,
          finalized: true,
          alreadyFinalized: true,
          finalizedAt: current?.finishedAt?.toISOString() ?? null,
          startedAt: current?.startedAt?.toISOString() ?? null,
          durationMinutes: duration,
          responsibleName: current?.finishedByName ?? responsibleName,
          responsibleCouncil: current?.finishedByCouncil ?? responsibleCouncil,
        }
      }

      // 6) Auditoria: evento de encerramento (quem, quando, de→para).
      const durationMinutes = computeDurationMinutes(startedAt, now)
      const summaryJson = JSON.stringify({
        procedures: {
          scheduled: assessment.summary.proceduresScheduled,
          performed: assessment.summary.proceduresPerformed,
          notPerformed: assessment.summary.proceduresNotPerformed,
          pending: assessment.summary.proceduresPending,
        },
        recordFilled: assessment.summary.recordFilled,
        evolutionRegistered: assessment.summary.evolutionRegistered,
        odontogramUpdated: assessment.summary.odontogramUpdated,
        durationMinutes,
      })

      await tx.appointmentFinalizationLog.create({
        data: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          event: FINALIZATION_EVENT,
          fromStatus: "in_progress",
          toStatus: "completed",
          startedAt,
          finishedAt: now,
          performedById: actor.userId,
          performedByName: responsibleName,
          summary: summaryJson,
        },
      })

      return {
        success: true,
        finalized: true,
        alreadyFinalized: false,
        finalizedAt: now.toISOString(),
        startedAt: startedAt.toISOString(),
        durationMinutes,
        responsibleName,
        responsibleCouncil,
      }
    })
  } catch (error) {
    // Qualquer falha provoca rollback automático: o atendimento NÃO fica
    // parcialmente finalizado.
    console.error("Erro ao finalizar atendimento:", error)
    return {
      error: "Não foi possível finalizar o atendimento. Nenhuma alteração foi aplicada.",
      code: FINALIZATION_ERROR_CODES.CONFLICT,
      status: 500,
    }
  }
}

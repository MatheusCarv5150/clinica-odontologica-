// ===========================================================================
// Domínio da FINALIZAÇÃO DO ATENDIMENTO — módulo Atendimento (Parte 9).
// ===========================================================================
//
// Fonte da verdade das REGRAS de encerramento. Backend e frontend leem daqui:
// nenhuma decisão de "pode finalizar?" é tomada apenas na tela.
//
// PRINCÍPIO ARQUITETURAL:
//   SALVAR ≠ FINALIZAR
//   Salvar   → "continuar trabalhando posteriormente."
//   Finalizar→ "este atendimento foi concluído e o registro clínico fechou."
//
// CICLO:
//   RASCUNHO
//     ↓
//   ATENDIMENTO EM ANDAMENTO
//     ↓
//   REVISÃO  (esta etapa: validação de pendências)
//     ↓
//   FINALIZAÇÃO (transação única, auditada)
//     ↓
//   ATENDIMENTO CONCLUÍDO
//     ↓
//   REGISTRO FECHADO (somente leitura)
//
// Este módulo NÃO acessa banco. Ele recebe um SNAPSHOT já montado pelo serviço
// e devolve o veredito + a lista de pendências. Isso mantém as regras testáveis
// isoladamente (sem I/O) e reutilizáveis pelo frontend para pré-visualização.

import { STATUS_LABELS } from "@/lib/schemas"

// ---------------------------------------------------------------------------
// Estados a partir dos quais é permitido finalizar
// ---------------------------------------------------------------------------

// Só um atendimento já INICIADO pode ser finalizado. Um atendimento que ainda
// não começou NÃO é finalizado diretamente (regra explícita da Parte 9).
export const FINALIZABLE_STATUSES = ["in_progress"] as const

export type FinalizableStatus = (typeof FINALIZABLE_STATUSES)[number]

export function canFinalizeStatus(status: string): boolean {
  return (FINALIZABLE_STATUSES as readonly string[]).includes(status)
}

// ---------------------------------------------------------------------------
// Severidade das pendências
// ---------------------------------------------------------------------------

// "blocking"     → IMPEDE a finalização (integridade / obrigatoriedade).
// "warning"      → exige decisão do profissional, mas não trava sozinha.
// "info"         → apenas informativo (não impede).
export type PendingSeverity = "blocking" | "warning" | "info"

export interface FinalizationPending {
  // Código estável (para testes e para a UI decidir a ação corretiva).
  code: string
  severity: PendingSeverity
  // Área do prontuário: "procedures" | "record" | "evolution" | "odontogram"
  // | "anamnesis" | "attendance" | "professional".
  area: FinalizationArea
  title: string
  description: string
  // Ação sugerida (ex.: revisar procedimentos) — o frontend usa para oferecer
  // o botão correto sem recriar a lógica.
  action: FinalizationAction
}

export type FinalizationArea =
  | "attendance"
  | "professional"
  | "procedures"
  | "record"
  | "evolution"
  | "odontogram"
  | "anamnesis"

export type FinalizationAction =
  | "none"
  | "go_procedures"
  | "go_record"
  | "go_evolution"
  | "go_odontogram"
  | "go_anamnesis"
  | "fix_blocking"

// ---------------------------------------------------------------------------
// Snapshot avaliado (montado pelo serviço a partir do banco)
// ---------------------------------------------------------------------------

export interface FinalizationSnapshot {
  attendance: {
    id: string
    status: string
    // Paciente resolvido a partir do atendimento (nunca do cliente).
    patientId: string | null
    patientName: string | null
    // Início registrado pelo backend ao iniciar o atendimento.
    startedAt: Date | null
  }
  professional: {
    // Nome do responsável informado para a finalização (resolvido no serviço).
    name: string | null
    // O backend exige que o nome corresponda ao profissional autenticado.
    authenticated: boolean
  }
  procedures: {
    scheduledCount: number
    performedCount: number
    notPerformedCount: number
    // Previstos ainda não classificados (pending/in_progress).
    pendingCount: number
    // Execuções em estado inconsistente (ex.: realizado sem dente quando o
    // procedimento exige dente — detectado no serviço).
    inconsistentCount: number
  }
  record: {
    // Existe registro clínico (AppointmentEvolution)?
    exists: boolean
    // Campo obrigatório "Achados clínicos" preenchido?
    hasClinicalFindings: boolean
    // Campo obrigatório "Conduta" preenchido?
    hasConduct: boolean
    // Avaliação/diagnóstico (obrigatório na regra clínica adotada pela Parte 6).
    hasEvaluation: boolean
    // Intercorrência marcada exige descrição.
    intercurrentIncomplete: boolean
  }
  evolution: {
    // Existe texto de evolução clínica registrado?
    registered: boolean
  }
  odontogram: {
    // Eventos registrados neste atendimento (informativo/consistência).
    eventCount: number
    // Há alterações de odontograma pendentes de persistência? (reservado).
    hasUnpersistedChanges: boolean
  }
  anamnesis: {
    // Anamnese obrigatória apenas quando aplicável (ex.: primeira consulta do
    // paciente). O serviço decide se é aplicável e marca aqui.
    required: boolean
    provided: boolean
  }
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------

export interface FinalizationAssessment {
  canFinalize: boolean
  blocking: FinalizationPending[]
  warnings: FinalizationPending[]
  info: FinalizationPending[]
  // Resumo consolidado para exibição na etapa de revisão.
  summary: FinalizationSummary
  // Motivo principal quando bloqueado (para a mensagem destacada).
  blockingReason: string | null
}

export interface FinalizationSummary {
  patientName: string | null
  status: string
  statusLabel: string
  startedAt: Date | null
  durationMinutes: number | null
  proceduresScheduled: number
  proceduresPerformed: number
  proceduresNotPerformed: number
  proceduresPending: number
  recordFilled: boolean
  evolutionRegistered: boolean
  odontogramUpdated: boolean
}

// Duração derivada dos timestamps (nunca digitada). Arredonda para baixo em
// minutos; retorna null se não houver início válido.
export function computeDurationMinutes(
  startedAt: Date | null,
  reference: Date
): number | null {
  if (!startedAt) return null
  const start = startedAt.getTime()
  if (Number.isNaN(start)) return null
  const diff = reference.getTime() - start
  if (diff < 0) return null
  return Math.floor(diff / 60000)
}

// Texto legível da duração (ex.: "47 minutos", "1h 05min", "menos de 1 min").
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null
  if (minutes < 1) return "menos de 1 min"
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? "" : "s"}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) return `${hours}h`
  return `${hours}h ${String(rest).padStart(2, "0")}min`
}

// Avalia o snapshot e devolve o veredito + pendências classificadas.
//
// REGRAS (não assumir que tudo está preenchido):
//  - BLOQUEANTES: atendimento inexistente/inconsistente; status não finalizável;
//    paciente/profissional inválido; registro clínico obrigatório ausente;
//    intercorrência sem descrição.
//  - AVISOS: procedimentos previstos não classificados; evolução não registrada;
//    anamnese obrigatória pendente.
//  - INFO: ausência de eventos de odontograma (não impede).
export function assessFinalization(
  snapshot: FinalizationSnapshot,
  reference: Date = new Date()
): FinalizationAssessment {
  const blocking: FinalizationPending[] = []
  const warnings: FinalizationPending[] = []
  const info: FinalizationPending[] = []

  // --- Integridade básica (bloqueante) ---
  if (!snapshot.attendance.patientId || !snapshot.attendance.patientName) {
    blocking.push({
      code: "PATIENT_INVALID",
      severity: "blocking",
      area: "attendance",
      title: "Paciente inválido",
      description:
        "Não é possível finalizar este atendimento porque o paciente associado não pôde ser identificado.",
      action: "fix_blocking",
    })
  }

  // --- Status finalizável (bloqueante) ---
  if (!canFinalizeStatus(snapshot.attendance.status)) {
    const statusLabel = STATUS_LABELS[snapshot.attendance.status] ?? snapshot.attendance.status
    blocking.push({
      code: "INVALID_STATUS",
      severity: "blocking",
      area: "attendance",
      title: "Atendimento não está em andamento",
      description:
        snapshot.attendance.status === "completed"
          ? "Este atendimento já foi finalizado."
          : `Não é possível finalizar um atendimento com status "${statusLabel}". Inicie o atendimento para continuar.`,
      action: "fix_blocking",
    })
  }

  // --- Profissional responsável (bloqueante) ---
  if (!snapshot.professional.name || !snapshot.professional.name.trim()) {
    blocking.push({
      code: "PROFESSIONAL_REQUIRED",
      severity: "blocking",
      area: "professional",
      title: "Profissional responsável não informado",
      description:
        "É necessário identificar o profissional responsável pelo atendimento para registrar o encerramento.",
      action: "fix_blocking",
    })
  } else if (!snapshot.professional.authenticated) {
    blocking.push({
      code: "PROFESSIONAL_INVALID",
      severity: "blocking",
      area: "professional",
      title: "Profissional inválido",
      description:
        "O profissional responsável informado não corresponde ao usuário autenticado neste atendimento.",
      action: "fix_blocking",
    })
  }

  // --- Registro clínico obrigatório (bloqueante) ---
  if (!snapshot.record.exists) {
    blocking.push({
      code: "RECORD_MISSING",
      severity: "blocking",
      area: "record",
      title: "Registro clínico ausente",
      description:
        "Não é possível finalizar este atendimento porque o registro clínico obrigatório não foi preenchido.",
      action: "go_record",
    })
  } else {
    if (!snapshot.record.hasClinicalFindings) {
      blocking.push({
        code: "RECORD_FINDINGS_MISSING",
        severity: "blocking",
        area: "record",
        title: "Achados clínicos não preenchidos",
        description:
          "Não é possível finalizar este atendimento porque os achados clínicos (campo obrigatório) não foram preenchidos.",
        action: "go_record",
      })
    }
    if (!snapshot.record.hasEvaluation) {
      blocking.push({
        code: "RECORD_EVALUATION_MISSING",
        severity: "blocking",
        area: "record",
        title: "Avaliação / diagnóstico não preenchida",
        description:
          "Não é possível finalizar este atendimento porque a avaliação/diagnóstico (campo obrigatório) não foi preenchida.",
        action: "go_record",
      })
    }
    if (!snapshot.record.hasConduct) {
      blocking.push({
        code: "RECORD_CONDUCT_MISSING",
        severity: "blocking",
        area: "record",
        title: "Conduta não preenchida",
        description:
          "Não é possível finalizar este atendimento porque a conduta (campo obrigatório) não foi preenchida.",
        action: "go_record",
      })
    }
    if (snapshot.record.intercurrentIncomplete) {
      blocking.push({
        code: "RECORD_INTERCURRENT_INCOMPLETE",
        severity: "blocking",
        area: "record",
        title: "Intercorrência sem descrição",
        description:
          "Há uma intercorrência marcada no registro clínico sem descrição. Descreva-a ou desmarque a opção.",
        action: "go_record",
      })
    }
  }

  // --- Procedimentos (aviso; nunca assumir realizado) ---
  if (snapshot.procedures.scheduledCount > 0 && snapshot.procedures.pendingCount > 0) {
    const n = snapshot.procedures.pendingCount
    warnings.push({
      code: "PROCEDURES_PENDING",
      severity: "warning",
      area: "procedures",
      title: `${n} procedimento${n === 1 ? "" : "s"} previsto${n === 1 ? "" : "s"} sem classificação`,
      description:
        n === 1
          ? "Existe 1 procedimento previsto que ainda não foi classificado. Decida se ele foi realizado ou não antes de finalizar."
          : `Existem ${n} procedimentos previstos que ainda não foram classificados. Decida o que aconteceu com cada um antes de finalizar.`,
      action: "go_procedures",
    })
  }

  // --- Evolução (aviso) ---
  if (!snapshot.evolution.registered) {
    warnings.push({
      code: "EVOLUTION_MISSING",
      severity: "warning",
      area: "evolution",
      title: "Evolução não registrada",
      description:
        "A evolução clínica deste atendimento ainda não foi registrada. Recomenda-se registrar antes de finalizar.",
      action: "go_evolution",
    })
  }

  // --- Anamnese (aviso quando aplicável) ---
  if (snapshot.anamnesis.required && !snapshot.anamnesis.provided) {
    warnings.push({
      code: "ANAMNESIS_REQUIRED",
      severity: "warning",
      area: "anamnesis",
      title: "Anamnese obrigatória pendente",
      description:
        "A anamnese é obrigatória para este atendimento e ainda não foi preenchida.",
      action: "go_anamnesis",
    })
  }

  // --- Odontograma (info) ---
  if (snapshot.odontogram.eventCount === 0) {
    info.push({
      code: "ODONTOGRAM_UNCHANGED",
      severity: "info",
      area: "odontogram",
      title: "Odontograma não atualizado",
      description:
        "Nenhum evento odontológico foi registrado neste atendimento. Não há impedimento, mas confirme se o odontograma está em dia.",
      action: "none",
    })
  }

  // --- Consistência de procedimentos (bloqueante/integridade) ---
  if (snapshot.procedures.inconsistentCount > 0) {
    blocking.push({
      code: "PROCEDURES_INCONSISTENT",
      severity: "blocking",
      area: "procedures",
      title: "Procedimento com estado inconsistente",
      description:
        "Há procedimento com estado inconsistente no atendimento. Corrija-o antes de finalizar para preservar a integridade do prontuário.",
      action: "go_procedures",
    })
  }

  const durationMinutes = computeDurationMinutes(
    snapshot.attendance.startedAt,
    reference
  )

  const summary: FinalizationSummary = {
    patientName: snapshot.attendance.patientName,
    status: snapshot.attendance.status,
    statusLabel: STATUS_LABELS[snapshot.attendance.status] ?? snapshot.attendance.status,
    startedAt: snapshot.attendance.startedAt,
    durationMinutes,
    proceduresScheduled: snapshot.procedures.scheduledCount,
    proceduresPerformed: snapshot.procedures.performedCount,
    proceduresNotPerformed: snapshot.procedures.notPerformedCount,
    proceduresPending: snapshot.procedures.pendingCount,
    recordFilled:
      snapshot.record.exists &&
      snapshot.record.hasClinicalFindings &&
      snapshot.record.hasEvaluation &&
      snapshot.record.hasConduct,
    evolutionRegistered: snapshot.evolution.registered,
    odontogramUpdated: snapshot.odontogram.eventCount > 0,
  }

  return {
    canFinalize: blocking.length === 0,
    blocking,
    warnings,
    info,
    summary,
    blockingReason: blocking[0]?.description ?? null,
  }
}

// ---------------------------------------------------------------------------
// Evento de auditoria
// ---------------------------------------------------------------------------

export const FINALIZATION_EVENT = "ATENDIMENTO_FINALIZADO" as const

// Motivos possíveis de rejeição (resposta padronizada da API).
export const FINALIZATION_ERROR_CODES = {
  NOT_FOUND: "NOT_FOUND",
  INVALID_STATUS: "INVALID_STATUS",
  ALREADY_FINALIZED: "ALREADY_FINALIZED",
  PENDING_BLOCKING: "PENDING_BLOCKING",
  PROFESSIONAL_REQUIRED: "PROFESSIONAL_REQUIRED",
  PROFESSIONAL_INVALID: "PROFESSIONAL_INVALID",
  CONFLICT: "CONFLICT",
} as const

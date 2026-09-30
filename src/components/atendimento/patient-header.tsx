"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  Loader2,
  Lock,
  Phone,
  Play,
  ShieldCheck,
  Stethoscope,
  Timer,
} from "lucide-react"
import { formatCPF, formatPhone } from "@/lib/schemas"
import {
  formatAttendanceDateTime,
  formatElapsedMinutes,
  getAttendanceStatusMeta,
} from "@/lib/attendance-status"
import { cn } from "@/lib/utils"
import { useAsyncData } from "@/lib/use-async-data"
import { PatientAlertModal } from "./patient-alert-modal"
import { PatientHistory } from "./patient-history"
import { AnamnesisPanel } from "./anamnesis-panel"
import { OdontogramPanel } from "./odontogram-panel"
import { EvolutionPanel } from "./evolution-panel"
import { EvolutionTimelinePanel } from "./evolution-timeline-panel"
import { ProceduresPanel } from "./procedures-panel"
import { TreatmentPlanPanel } from "./treatment-plan-panel"
import { PrescriptionPanel } from "./prescription-panel"
import { DocumentsPanel } from "./documents-panel"
import { FinalizationPanel } from "./finalization-panel"
import {
  ProntuarioSidebar,
  type ProntuarioSection,
} from "./prontuario-sidebar"

// ---------------------------------------------------------------------------
// Tipos do cabeçalho (contrato com GET /api/attendance/[id])
// ---------------------------------------------------------------------------

export interface AttendanceHeaderData {
  attendance: {
    id: string
    code: string
    date: string
    time: string | null
    status: string
    startedAt: string | null
    // Finalização formal (Parte 9).
    finishedAt: string | null
    finishedByName: string | null
  }
  patient: {
    id: string
    fullName: string
    cpf: string
    phone: string | null
    birthDate: string | null
    age: number | null
    hasHealthNotes: boolean
  }
  procedures: Array<{ id: string; name: string; quantity: number }>
  // Preparado para quando a relação com usuários/profissionais existir.
  professional: { id: string; name: string } | null
}

interface PatientHeaderProps {
  attendanceId: string
  onBack: () => void
  // Chamado quando o atendimento muda de status (ex.: iniciado), para que a
  // fila seja recarregada sem sair da tela.
  onAttendanceChanged?: () => void
}

// ---------------------------------------------------------------------------
// Subcomponentes (estrutura preparada para as próximas partes do prontuário)
// ---------------------------------------------------------------------------

function PatientIdentity({ patient }: { patient: AttendanceHeaderData["patient"] }) {
  const initials = getInitials(patient.fullName)

  return (
    <div className="flex min-w-0 items-start gap-4">
      {/* Avatar com iniciais — não há suporte a foto de paciente no cadastro
          atual; quando existir, este bloco é substituído pela imagem real. */}
      <div
        aria-hidden="true"
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-100 text-lg font-semibold text-blue-700"
      >
        {initials}
      </div>

      <div className="min-w-0">
        <h2 className="break-words text-xl font-bold leading-tight text-gray-900">
          {patient.fullName}
        </h2>

        {/* Identidade clínica: nome + nascimento + idade + CPF juntos,
            permitindo a conferência rápida do paciente correto. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
          {patient.age !== null && (
            <span className="font-medium text-gray-700">
              {patient.age} {patient.age === 1 ? "ano" : "anos"}
            </span>
          )}
          {patient.birthDate && (
            <>
              {patient.age !== null && <span className="text-gray-300">•</span>}
              <span>Nascimento: {formatBirthDate(patient.birthDate)}</span>
            </>
          )}
          <span className="text-gray-300">•</span>
          <span>CPF: {formatCPF(patient.cpf)}</span>
          {patient.phone && (
            <>
              <span className="text-gray-300">•</span>
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5 text-gray-400" />
                {formatPhone(patient.phone)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function AppointmentSummary({
  attendance,
  professional,
}: {
  attendance: AttendanceHeaderData["attendance"]
  professional: AttendanceHeaderData["professional"]
}) {
  const startedLabel =
    attendance.status === "in_progress" && attendance.startedAt
      ? formatStartedTime(attendance.startedAt)
      : null
  const duration =
    attendance.status === "in_progress" && attendance.startedAt
      ? formatElapsedMinutes(attendance.startedAt)
      : null

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
      <div>
        <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
          Atendimento
        </dt>
        <dd className="mt-0.5 font-semibold tabular-nums text-gray-900">
          #{attendance.code}
        </dd>
      </div>

      <div>
        <dt className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          <CalendarDays className="h-3 w-3" />
          Data e horário
        </dt>
        <dd className="mt-0.5 flex items-center gap-1.5 font-medium text-gray-900">
          {formatAttendanceDateTime(attendance.date, attendance.time)}
        </dd>
      </div>

      {startedLabel && (
        <div>
          <dt className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            <Timer className="h-3 w-3" />
            Iniciado às
          </dt>
          <dd className="mt-0.5 font-medium text-gray-900">
            {startedLabel}
            {duration && (
              <span className="ml-1 font-normal text-gray-500">({duration})</span>
            )}
          </dd>
        </div>
      )}

      {professional && (
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Profissional responsável
          </dt>
          <dd className="mt-0.5 font-medium text-gray-900">{professional.name}</dd>
        </div>
      )}
    </dl>
  )
}

function AppointmentProcedures({
  procedures,
}: {
  procedures: AttendanceHeaderData["procedures"]
}) {
  const [expanded, setExpanded] = useState(false)
  const VISIBLE_LIMIT = 3

  if (procedures.length === 0) {
    return (
      <div className="text-sm text-gray-400">
        Nenhum procedimento previsto para este atendimento.
      </div>
    )
  }

  const hasOverflow = procedures.length > VISIBLE_LIMIT
  const visible = expanded ? procedures : procedures.slice(0, VISIBLE_LIMIT)
  const hiddenCount = procedures.length - VISIBLE_LIMIT

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
        <Stethoscope className="h-3 w-3" />
        {procedures.length === 1 ? "Procedimento previsto" : "Procedimentos previstos"}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map((p) => (
          <Badge key={p.id} variant="info" className="text-[11px]">
            {p.name}
            {p.quantity > 1 ? ` ×${p.quantity}` : ""}
          </Badge>
        ))}
        {hasOverflow && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200"
            aria-expanded={expanded}
          >
            {expanded ? "Mostrar menos" : `+${hiddenCount} mais`}
          </button>
        )}
      </div>
    </div>
  )
}

// Nível de alerta estruturado para suportar classificação futura
// (Informação / Atenção / Importante / Crítico). Nesta etapa usamos apenas o
// dado real existente: presença de observações cadastradas pelo responsável.
// Nenhuma classificação clínica é inferida automaticamente.
export type PatientAlertLevel = "info" | "attention" | "important" | "critical"

const ALERT_LEVEL_STYLES: Record<
  PatientAlertLevel,
  { border: string; bg: string; text: string; icon: string }
> = {
  info: {
    border: "border-blue-200",
    bg: "bg-blue-50",
    text: "text-blue-800",
    icon: "text-blue-600",
  },
  attention: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    text: "text-amber-800",
    icon: "text-amber-600",
  },
  important: {
    border: "border-orange-300",
    bg: "bg-orange-50",
    text: "text-orange-900",
    icon: "text-orange-600",
  },
  critical: {
    border: "border-red-300",
    bg: "bg-red-50",
    text: "text-red-900",
    icon: "text-red-600",
  },
}

function PatientAlerts() {
  const styles = ALERT_LEVEL_STYLES.attention

  return (
    <div
      className={cn("rounded-lg border p-3", styles.border, styles.bg)}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", styles.icon)} />
        <div>
          <p className={cn("text-sm font-semibold", styles.text)}>
            Informação importante sobre o paciente
          </p>
          <p className={cn("text-xs", styles.text)}>
            Paciente possui observações cadastradas. Verifique antes de iniciar o
            atendimento.
          </p>
        </div>
      </div>
    </div>
  )
}

// Resumo compacto dos alertas clínicos registrados na ANAMNESE.
// Alergias, condições e medicamentos ficam visíveis no cabeçalho sem exigir a
// abertura da anamnese. Nenhum alerta é inferido: só o que foi registrado.
function ClinicalAlertsSummary({
  alerts,
}: {
  alerts: Array<{ kind: string; text: string; detail?: string | null }>
}) {
  if (alerts.length === 0) return null

  const ordered = [
    ...alerts.filter((a) => a.kind === "allergy"),
    ...alerts.filter((a) => a.kind === "condition"),
    ...alerts.filter((a) => a.kind === "medication"),
    ...alerts.filter((a) => a.kind === "answer"),
  ]
  const hasAllergy = ordered.some((a) => a.kind === "allergy")

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-lg border p-3",
        hasAllergy ? "border-red-300 bg-red-50" : "border-amber-200 bg-amber-50"
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide",
          hasAllergy ? "text-red-800" : "text-amber-800"
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Alertas clínicos registrados
      </p>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {ordered.map((alert, index) => (
          <li
            key={`${alert.kind}-${alert.text}-${index}`}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              alert.kind === "allergy"
                ? "border-red-200 bg-white text-red-800"
                : alert.kind === "medication"
                  ? "border-blue-200 bg-white text-blue-800"
                  : "border-amber-200 bg-white text-amber-800"
            )}
            title={alert.detail ?? undefined}
          >
            {alert.text}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function PatientHeader({
  attendanceId,
  onBack,
  onAttendanceChanged,
}: PatientHeaderProps) {
  const router = useRouter()
  const [actionError, setActionError] = useState("")
  const [isStarting, setIsStarting] = useState(false)
  const [showAlert, setShowAlert] = useState(false)
  // Incrementado quando o próprio atendimento muda (ex.: início), para que o
  // histórico do paciente recarregue o bloco "atendimento atual" em sincronia.
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  // Incrementado quando o registro clínico (Parte 6) ou os procedimentos
  // (Parte 7) mudam, para que a Evolução (Parte 8) reflita imediatamente.
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0)
  // Área ativa do prontuário único. "historico" é a visão inicial (Parte 3).
  const [activeSection, setActiveSection] = useState<ProntuarioSection>("historico")

  // Finalização do atendimento (Parte 9). A identidade do profissional é a
  // mesma abordagem textual usada pelas Partes 4/6/7 (a arquitetura ainda não
  // possui módulo de sessão). O backend continua sendo a autoridade final.
  const [showFinalize, setShowFinalize] = useState(false)

  // Carrega apenas a contagem/textos dos alertas — dado leve e já exposto por
  // endpoint próprio, evitando trazer a anamnese inteira para o cabeçalho.
  const loadClinicalAlerts = useCallback(
    () =>
      fetch(`/api/attendance/${attendanceId}/alert`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : { alerts: [] }))
        .then((payload) =>
          Array.isArray(payload.alerts) ? payload.alerts : []
        )
        .catch(() => []),
    [attendanceId]
  )

  const { data: clinicalAlertsData, reload: reloadClinicalAlerts } =
    useAsyncData<Array<{ kind: string; text: string; detail?: string | null }>>(
      loadClinicalAlerts,
      [attendanceId]
    )

  // O componente abaixo espera um array; a ausência de dados vira lista vazia.
  const clinicalAlerts = useMemo(
    () => clinicalAlertsData ?? [],
    [clinicalAlertsData]
  )

  const loadHeader = useCallback(
    async () => {
      const res = await fetch(`/api/attendance/${attendanceId}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Não foi possível carregar o atendimento.")
      }
      return (await res.json()) as AttendanceHeaderData
    },
    [attendanceId]
  )

  const {
    data,
    error,
    isLoading,
    reload: reloadHeader,
  } = useAsyncData<AttendanceHeaderData>(loadHeader, [attendanceId])

  // Atualiza a duração superficialmente a cada minuto enquanto em atendimento.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (data?.attendance.status !== "in_progress") return
    const timer = setInterval(() => forceTick((t) => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [data?.attendance.status])

  async function handleStart() {
    setIsStarting(true)
    setActionError("")
    try {
      const res = await fetch(`/api/attendance/${attendanceId}/start`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      })
      if (res.ok) {
        await reloadHeader()
        setHistoryRefreshKey((k) => k + 1)
        onAttendanceChanged?.()
        return
      }
      const err = await res.json().catch(() => ({}))
      // Se já foi iniciado por outro usuário, apenas sincroniza a tela.
      if (err.code === "ALREADY_STARTED") {
        await reloadHeader()
        setHistoryRefreshKey((k) => k + 1)
        onAttendanceChanged?.()
        return
      }
      setActionError(err.error || "Não foi possível iniciar o atendimento.")
    } catch {
      setActionError("Erro de conexão. Tente novamente.")
    } finally {
      setIsStarting(false)
    }
  }

  // --- Estados de carregamento/erro mantendo o layout profissional ---
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-14 text-gray-400 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando atendimento...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-sm font-medium text-red-800">
          {error || "Atendimento não encontrado."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Voltar para a fila
          </Button>
          <Button variant="outline" size="sm" onClick={reloadHeader}>
            Tentar novamente
          </Button>
        </div>
      </div>
    )
  }

  const meta = getAttendanceStatusMeta(data.attendance.status)
  const isInProgress = data.attendance.status === "in_progress"
  const canStart = ["paid", "awaiting_attendance"].includes(data.attendance.status)
  const isCompleted = data.attendance.status === "completed"

  return (
    <>
      <section
        className={cn(
          "overflow-hidden rounded-xl border border-gray-200 border-l-4 bg-white shadow-sm",
          meta.accent
        )}
        aria-label="Cabeçalho do paciente"
      >
      {/* Barra superior: navegação de retorno + status + ação */}
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 transition-colors hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para a fila
        </button>

        <div className="flex flex-wrap items-center gap-3">
          <Badge className={cn("gap-1.5", meta.badge)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
            {meta.label}
          </Badge>

          {canStart && (
            <Button size="sm" onClick={handleStart} disabled={isStarting}>
              {isStarting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Iniciando...
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Iniciar atendimento
                </>
              )}
            </Button>
          )}

          {isInProgress && (
            <>
              <Button size="sm" variant="outline" disabled className="whitespace-nowrap">
                <Stethoscope className="h-3.5 w-3.5" />
                Continuar atendimento
              </Button>
              <Button
                size="sm"
                onClick={() => setShowFinalize(true)}
                className="whitespace-nowrap"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Finalizar atendimento
              </Button>
            </>
          )}

          {isCompleted && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowFinalize(true)}
              className="whitespace-nowrap"
            >
              <Lock className="h-3.5 w-3.5" />
              Ver finalização
            </Button>
          )}
        </div>
      </div>

      {/* Corpo do cabeçalho */}
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <PatientIdentity patient={data.patient} />

          <button
            type="button"
            onClick={() => router.push(`/pacientes?patient=${data.patient.id}`)}
            className="inline-flex shrink-0 items-center gap-1.5 self-start text-xs font-medium text-blue-700 transition-colors hover:text-blue-800 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Ver cadastro do paciente
          </button>
        </div>

        {actionError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {actionError}
          </div>
        )}

        <PatientAlerts />

        <ClinicalAlertsSummary alerts={clinicalAlerts} />

        {data.patient.hasHealthNotes && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAlert(true)}
              className="whitespace-nowrap"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Ver observações cadastradas
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-4 border-t border-gray-100 pt-4 lg:flex-row lg:items-start lg:justify-between">
          <AppointmentSummary
            attendance={data.attendance}
            professional={data.professional}
          />
        </div>

        <div className="border-t border-gray-100 pt-4">
          <AppointmentProcedures procedures={data.procedures} />
        </div>
      </div>

      {showAlert && (
        <PatientAlertModal
          patientId={data.patient.id}
          patientName={data.patient.fullName}
          cpf={data.patient.cpf}
          alerts={clinicalAlerts}
          onClose={() => setShowAlert(false)}
        />
      )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* PRONTUÁRIO ÚNICO: sidebar de navegação + área clínica ativa        */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col gap-5 lg:flex-row">
        <ProntuarioSidebar
          active={activeSection}
          onChange={setActiveSection}
          badges={{ anamnese: clinicalAlerts.length }}
        />

        <div className="min-w-0 flex-1">
          {activeSection === "historico" && (
            /* Parte 3 — Histórico do paciente.
               O backend resolve o paciente a partir do atendimento, garantindo
               o isolamento entre pacientes. */
            <PatientHistory
              attendanceId={attendanceId}
              refreshKey={historyRefreshKey}
            />
          )}

          {activeSection === "anamnese" && (
            /* Parte 4 — Anamnese (perfil clínico versionado + atendimento). */
            <AnamnesisPanel
              attendanceId={attendanceId}
              onSaved={loadClinicalAlerts}
            />
          )}

          {activeSection === "odontograma" && (
            /* Parte 5 — Odontograma clínico orientado a dados.
               Cada dente é uma entidade clínica; o desenho representa os
               dados registrados (estado atual) e o histórico é preservado. */
            <OdontogramPanel attendanceId={attendanceId} />
          )}

          {activeSection === "registro" && (
            /* Parte 6 — REGISTRO DO ATENDIMENTO.
               O profissional documenta queixa, achados, avaliação,
               conduta, procedimentos realizados, evolução clínica,
               orientações, intercorrências e observações DO ATENDIMENTO
               ATUAL. É um formulário de entrada de dados clínicos. */
            <EvolutionPanel
              attendanceId={attendanceId}
              onSaved={() => {
                void reloadHeader()
                void reloadClinicalAlerts()
                setTimelineRefreshKey((k) => k + 1)
              }}
              onFinalized={() => {
                void reloadHeader()
                void reloadClinicalAlerts()
                setTimelineRefreshKey((k) => k + 1)
              }}
            />
          )}

          {activeSection === "evolucao" && (
            /* Parte 8 — EVOLUÇÃO: LINHA DO TEMPO CLÍNICA DO PACIENTE.
               Visão longitudinal (somente leitura) que conecta os atendimentos
               já registrados: procedimentos, dentes, intercorrências e
               resumos clínicos em ordem cronológica. Não é um formulário. */
            <EvolutionTimelinePanel
              attendanceId={attendanceId}
              refreshKey={timelineRefreshKey + historyRefreshKey}
              onContinueAttendance={() => setActiveSection("registro")}
            />
          )}

          {activeSection === "procedimentos" && (
            /* Parte 7 — Procedimentos do atendimento.
               Responde "o que estava previsto e o que foi realmente feito".
               A Agenda é a fonte do previsto; a execução gera o realizado.
               Procedimento realizado com dente alimenta o odontograma. */
            <ProceduresPanel
              attendanceId={attendanceId}
              onSaved={() => {
                void reloadHeader()
                void reloadClinicalAlerts()
                setTimelineRefreshKey((k) => k + 1)
              }}
            />
          )}

          {activeSection === "plano" && (
            /* Parte 10.1 — PLANO DE TRATAMENTO.
               Visão longitudinal do cuidado (para onde o tratamento está indo).
               O item referencia o catálogo REAL de procedimentos e usa a MESMA
               numeração de dente do odontograma. Planejar NÃO altera o estado
               clínico do dente. */
            <TreatmentPlanPanel
              attendanceId={attendanceId}
              onChanged={() => setTimelineRefreshKey((k) => k + 1)}
            />
          )}

          {activeSection === "prescricao" && (
            /* Parte 10.2 — PRESCRIÇÃO.
               Registro clínico das prescrições vinculadas ao paciente e ao
               atendimento. Nenhuma medicação é sugerida automaticamente; o
               histórico é preservado e o cancelamento é controlado. */
            <PrescriptionPanel
              attendanceId={attendanceId}
              onChanged={() => setTimelineRefreshKey((k) => k + 1)}
            />
          )}

          {activeSection === "documentos" && (
            /* Parte 10.3 — DOCUMENTOS / IMAGENS.
               Arquivos clínicos do paciente (radiografias, fotos, exames,
               PDFs) vinculados ao atendimento, com exclusão lógica e
               armazenamento abstrato (troca por object storage no futuro). */
            <DocumentsPanel
              attendanceId={attendanceId}
              onChanged={() => setTimelineRefreshKey((k) => k + 1)}
            />
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* FINALIZAÇÃO DO ATENDIMENTO (Parte 9) — encerramento formal.        */}
      {/* O painel conduz a revisão de pendências e a confirmação; o backend */}
      {/* executa a finalização transacional e fecha o registro clínico.     */}
      {/* ------------------------------------------------------------------ */}
      {showFinalize && (
        <FinalizationPanel
          attendanceId={attendanceId}
          patientName={data.patient.fullName}
          responsibleName={
            data.attendance.finishedByName ||
            data.professional?.name ||
            ""
          }
          professionalId={data.professional?.id ?? null}
          isFinalized={isCompleted}
          onFinalized={async () => {
            setShowFinalize(false)
            await reloadHeader()
            setHistoryRefreshKey((k) => k + 1)
            setTimelineRefreshKey((k) => k + 1)
            onAttendanceChanged?.()
          }}
          onNavigate={(section) => {
            setShowFinalize(false)
            setActiveSection(section)
          }}
          onClose={() => setShowFinalize(false)}
        />
      )}
    </>
  )
}
// ---------------------------------------------------------------------------
// Helpers de apresentação
// ---------------------------------------------------------------------------

function getInitials(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (
    parts[0].charAt(0) + parts[parts.length - 1].charAt(0)
  ).toUpperCase()
}

// A data de nascimento é armazenada em UTC à meia-noite; formatamos em UTC
// para não deslocar o dia conforme o fuso do navegador.
function formatBirthDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("pt-BR", { timeZone: "UTC" })
}

function formatStartedTime(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

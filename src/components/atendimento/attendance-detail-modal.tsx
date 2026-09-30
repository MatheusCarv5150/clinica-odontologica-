"use client"

import { useCallback } from "react"
import {
  AlertTriangle,
  CalendarDays,
  ClipboardList,
  FileText,
  Loader2,
  Lock,
  Printer,
  Stethoscope,
  UserRound,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAsyncData } from "@/lib/use-async-data"
import { formatCPF } from "@/lib/schemas"
import {
  formatTimelineAuditStamp,
  formatTimelineCardDate,
  formatTimelineTime,
} from "@/lib/evolution-timeline"
import { getHistoryStatusMeta } from "@/lib/patient-history"

// ===========================================================================
// Atendimento COMPLETO em modo consulta — "Ver atendimento completo" (Parte 8).
//
// Abre o atendimento correspondente de um item da evolução. Para atendimentos
// ANTIGOS o modo é SOMENTE LEITURA: o backend devolve `readOnly: true` e a
// interface não oferece nenhuma ação de escrita — evitando alteração silenciosa
// de registros clínicos passados.
//
// Exibe: cabeçalho, anamnese registrada, registro clínico, procedimentos
// (previsto x realizado) e eventos do odontograma do atendimento.
// ===========================================================================

interface AttendanceDetailModalProps {
  /** Atendimento de referência (o aberto no prontuário). */
  attendanceId: string
  /** Atendimento a ser consultado. */
  recordId: string
  onClose: () => void
}

interface DetailResponse {
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
      name: string
      toothNumber: string | null
      surfacesLabel: string
      status: string
      material: string | null
      notes: string | null
      professionalName: string | null
    }>
  } | null
  procedures: {
    scheduled: Array<{
      id: string
      name: string
      quantity: number
      totalPrice: number
    }>
    executions: Array<{
      id: string
      name: string
      origin: string
      status: string
      toothNumber: string | null
      surfacesLabel: string
      notes: string | null
      professionalName: string | null
    }>
  }
  odontogram: {
    events: Array<{
      id: string
      toothNumber: string
      kind: string
      label: string
      surfacesLabel: string
      status: string
    }>
  }
  audit: {
    recordCreatedAt: string | null
    recordUpdatedAt: string | null
  }
}

// Bloco de campo clínico: só renderiza quando há conteúdo real.
function Field({ label, value }: { label: string; value: string | null }) {
  if (!value?.trim()) return null
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700">{value}</p>
    </div>
  )
}

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
      {icon}
      {children}
    </h3>
  )
}

export function AttendanceDetailModal({
  attendanceId,
  recordId,
  onClose,
}: AttendanceDetailModalProps) {
  const load = useCallback(async () => {
    const res = await fetch(
      `/api/attendance/${attendanceId}/records/${recordId}`,
      { cache: "no-store" }
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || "Não foi possível carregar o atendimento.")
    }
    return (await res.json()) as DetailResponse
  }, [attendanceId, recordId])

  const { data, isLoading, error } = useAsyncData<DetailResponse>(load, [
    attendanceId,
    recordId,
  ])

  const statusMeta = data ? getHistoryStatusMeta(data.attendance.status) : null
  const auditCreated = formatTimelineAuditStamp(data?.audit.recordCreatedAt ?? null)
  const auditUpdated = formatTimelineAuditStamp(data?.audit.recordUpdatedAt ?? null)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/50 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Atendimento completo"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="my-4 w-full max-w-3xl rounded-xl bg-white shadow-xl">
        {/* Barra superior */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-gray-900">
              Atendimento completo
            </h2>
            {data?.attendance.readOnly && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                <Lock className="h-3 w-3" />
                Somente leitura
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Fechar"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Carregando atendimento...
          </div>
        )}

        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="h-10 w-10 text-red-300" />
            <p className="mt-2 text-sm font-medium text-red-800">{error}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Fechar
            </button>
          </div>
        )}

        {data && !isLoading && (
          <div className="max-h-[75vh] space-y-5 overflow-y-auto p-5">
            {/* Cabeçalho resumido */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">
                  {data.patient.fullName}
                </p>
                {statusMeta && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      statusMeta.badge
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dot)} />
                    {statusMeta.label}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
                  {formatTimelineCardDate(data.attendance.date)}
                  {formatTimelineTime(data.attendance.time)
                    ? ` • ${formatTimelineTime(data.attendance.time)}`
                    : ""}
                </span>
                <span>Atendimento #{data.attendance.code}</span>
                {data.patient.age !== null && <span>{data.patient.age} anos</span>}
                <span>CPF: {formatCPF(data.patient.cpf)}</span>
                {data.professional && (
                  <span className="inline-flex items-center gap-1">
                    <UserRound className="h-3.5 w-3.5 text-gray-400" />
                    {data.professional.name}
                  </span>
                )}
              </div>
            </div>

            {/* Anamnese registrada */}
            {data.anamnesis && (
              <section className="space-y-3">
                <SectionTitle icon={<ClipboardList className="h-4 w-4 text-blue-600" />}>
                  Anamnese do atendimento
                </SectionTitle>
                <div className="grid gap-3 rounded-lg border border-gray-200 p-3.5 sm:grid-cols-2">
                  <Field label="Queixa principal" value={data.anamnesis.chiefComplaint} />
                  <Field label="Motivo da consulta" value={data.anamnesis.visitReason} />
                  <Field
                    label="História da queixa"
                    value={data.anamnesis.complaintHistory}
                  />
                  <Field
                    label="Sintomas associados"
                    value={data.anamnesis.associatedSymptoms}
                  />
                  <Field label="Ansiedade" value={data.anamnesis.anxietyNotes} />
                  <Field label="Observações" value={data.anamnesis.notes} />
                </div>
              </section>
            )}

            {/* Registro clínico */}
            <section className="space-y-3">
              <SectionTitle icon={<FileText className="h-4 w-4 text-blue-600" />}>
                Registro clínico
              </SectionTitle>

              {data.evolution ? (
                <div className="space-y-3">
                  {data.evolution.intercurrentHas && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Intercorrência registrada
                      </p>
                      {data.evolution.intercurrentDescription && (
                        <p className="mt-1 text-xs text-amber-900">
                          {data.evolution.intercurrentDescription}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="grid gap-3 rounded-lg border border-gray-200 p-3.5">
                    <Field label="Queixa" value={data.evolution.chiefComplaint} />
                    <Field
                      label="Achados clínicos"
                      value={data.evolution.clinicalFindings}
                    />
                    <Field label="Avaliação" value={data.evolution.evaluation} />
                    <Field label="Conduta" value={data.evolution.conduct} />
                    <Field label="Evolução" value={data.evolution.evolution} />
                    <Field label="Orientações" value={data.evolution.guidance} />
                    <Field label="Observações" value={data.evolution.observations} />
                  </div>

                  {/* Auditoria do registro */}
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
                    {data.evolution.finalized && data.evolution.finalizedAt ? (
                      <span>
                        Finalizado por{" "}
                        <strong className="font-medium text-gray-700">
                          {data.evolution.finalizedByName ?? "profissional"}
                        </strong>{" "}
                        em {formatTimelineAuditStamp(data.evolution.finalizedAt)}
                      </span>
                    ) : (
                      <span>Registro não finalizado (rascunho no momento da consulta).</span>
                    )}
                    {auditCreated && <span> • Criado em {auditCreated}</span>}
                    {auditUpdated && auditUpdated !== auditCreated && (
                      <span> • Última alteração em {auditUpdated}</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-400">
                  Este atendimento não possui registro clínico estruturado.
                </p>
              )}
            </section>

            {/* Procedimentos */}
            {(data.procedures.scheduled.length > 0 ||
              data.procedures.executions.length > 0) && (
              <section className="space-y-3">
                <SectionTitle icon={<Stethoscope className="h-4 w-4 text-blue-600" />}>
                  Procedimentos
                </SectionTitle>

                {data.procedures.scheduled.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      Previstos na Agenda
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {data.procedures.scheduled.map((p) => (
                        <li
                          key={p.id}
                          className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-700"
                        >
                          {p.name}
                          {p.quantity > 1 ? ` ×${p.quantity}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {data.procedures.executions.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      Executados no atendimento
                    </p>
                    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                      {data.procedures.executions.map((execution) => (
                        <li
                          key={execution.id}
                          className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <span className="font-medium text-gray-800">
                            {execution.name}
                          </span>
                          <span className="text-xs text-gray-500">
                            {execution.toothNumber
                              ? `Dente ${execution.toothNumber}`
                              : "Sem dente"}
                            {execution.surfacesLabel
                              ? ` • ${execution.surfacesLabel}`
                              : ""}
                            {execution.professionalName
                              ? ` • ${execution.professionalName}`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* Odontograma do atendimento */}
            {data.odontogram.events.length > 0 && (
              <section className="space-y-3">
                <SectionTitle icon={<Stethoscope className="h-4 w-4 text-blue-600" />}>
                  Odontograma — registros deste atendimento
                </SectionTitle>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                  {data.odontogram.events.map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm"
                    >
                      <span className="font-semibold text-gray-900">
                        Dente {event.toothNumber}
                      </span>
                      <span className="text-gray-700">{event.label}</span>
                      {event.surfacesLabel && (
                        <span className="text-xs text-gray-500">
                          {event.surfacesLabel}
                        </span>
                      )}
                      <span
                        className={cn(
                          "ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium",
                          event.status === "performed"
                            ? "bg-green-50 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        )}
                      >
                        {event.status === "performed" ? "Realizado" : event.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Rodapé de ações */}
            <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-4">
              <span className="text-[11px] text-gray-400">
                Atendimento de {formatTimelineCardDate(data.attendance.date)} —
                registro histórico preservado.
              </span>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                <Printer className="h-3.5 w-3.5" />
                Imprimir
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

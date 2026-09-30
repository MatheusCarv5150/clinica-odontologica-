"use client"

import { useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  FileText,
  Stethoscope,
  UserRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type TimelineEntry,
  formatTimelineAuditStamp,
  formatTimelineCardDate,
  formatTimelineTime,
  getTimelineKindMeta,
  summarizeEvolutionText,
} from "@/lib/evolution-timeline"

// ===========================================================================
// Card da EVOLUÇÃO CLÍNICA (Parte 8).
//
// Apresenta um RESUMO INTELIGENTE do atendimento na linha do tempo:
//   data • profissional • status • procedimentos • dentes • resumo • intercorrência
//
// O detalhamento completo NÃO é exibido aqui — é acessado por
// "Ver atendimento completo". Nunca mostramos anamnese inteira, documentos ou
// prescrição neste card: esses módulos têm áreas próprias.
// ===========================================================================

interface TimelineCardProps {
  entry: TimelineEntry
  /** Posição na timeline — usado para desenhar o conector vertical. */
  isLast?: boolean
  onOpenFull: (entry: TimelineEntry) => void
  onFilterTooth?: (tooth: string) => void
}

export function TimelineCard({
  entry,
  isLast = false,
  onOpenFull,
  onFilterTooth,
}: TimelineCardProps) {
  const [showIntercurrent, setShowIntercurrent] = useState(false)
  const meta = getTimelineKindMeta(entry.kind)
  const timeLabel = formatTimelineTime(entry.time)
  const summary = summarizeEvolutionText(entry.evolutionSummary)
  const auditStamp = formatTimelineAuditStamp(entry.recordCreatedAt)

  // Um item não clínico (cancelado/não compareceu) é neutro: não mostra
  // procedimentos nem resumo clínico, porque NÃO houve evolução clínica.
  const isClinical = meta.clinical

  return (
    <li className="relative flex gap-4">
      {/* Trilho vertical + marcador */}
      <div className="relative flex w-5 shrink-0 justify-center">
        <span
          aria-hidden="true"
          className={cn(
            "z-10 mt-5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white",
            meta.dot
          )}
        />
        {!isLast && (
          <span
            aria-hidden="true"
            className="absolute top-5 h-full w-px bg-gray-200"
          />
        )}
      </div>

      <div className="min-w-0 flex-1 pb-5">
        <article
          className={cn(
            "rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md",
            entry.isCurrent ? "border-blue-300 ring-1 ring-blue-100" : "border-gray-200"
          )}
          aria-label={`Evolução de ${formatTimelineCardDate(entry.date)}`}
        >
          {/* Cabeçalho: data • hora • status */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <time
              dateTime={entry.date}
              className="text-sm font-bold tracking-tight text-gray-900"
            >
              {formatTimelineCardDate(entry.date)}
            </time>
            {timeLabel && (
              <>
                <span className="text-gray-300" aria-hidden="true">
                  •
                </span>
                <span className="inline-flex items-center gap-1 text-sm font-medium tabular-nums text-gray-600">
                  <Clock className="h-3.5 w-3.5 text-gray-400" />
                  {timeLabel}
                </span>
              </>
            )}
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                meta.badge
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </span>
          </div>

          {/* Profissional */}
          <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-700">
            <UserRound className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            {entry.professional ? (
              <span className="font-medium">{entry.professional.name}</span>
            ) : (
              <span className="italic text-gray-400">
                Profissional não informado
              </span>
            )}
          </p>

          {isClinical && (
            <>
              {/* Queixa (resumo) */}
              {entry.chiefComplaint && (
                <p className="mt-3 text-sm text-gray-600">
                  <span className="font-medium text-gray-700">Queixa: </span>
                  {entry.chiefComplaint}
                </p>
              )}

              {/* Intercorrência: indicador sempre visível, detalhe expansível */}
              {entry.hasIntercurrent && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50">
                  <button
                    type="button"
                    onClick={() => setShowIntercurrent((v) => !v)}
                    aria-expanded={showIntercurrent}
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-amber-800"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Intercorrência registrada
                    {entry.intercurrentDescription && (
                      <ChevronDown
                        className={cn(
                          "ml-auto h-3.5 w-3.5 transition-transform",
                          showIntercurrent && "rotate-180"
                        )}
                      />
                    )}
                  </button>
                  {showIntercurrent && entry.intercurrentDescription && (
                    <p className="border-t border-amber-200 px-3 py-2 text-xs text-amber-900">
                      {entry.intercurrentDescription}
                    </p>
                  )}
                </div>
              )}

              {/* Procedimentos realizados */}
              {entry.procedures.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    <Stethoscope className="h-3 w-3" />
                    {entry.procedures.length === 1
                      ? "Procedimento realizado"
                      : "Procedimentos realizados"}
                  </p>
                  <ul className="space-y-1">
                    {entry.procedures.map((proc) => (
                      <li
                        key={`${proc.id}-${proc.name}`}
                        className="flex flex-wrap items-baseline gap-x-2 text-sm text-gray-800"
                      >
                        <span className="font-medium">{proc.name}</span>
                        {proc.toothNumber && (
                          <span className="text-xs text-gray-500">
                            Dente {proc.toothNumber}
                            {proc.surfacesLabel ? ` • ${proc.surfacesLabel}` : ""}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Dentes envolvidos (agregados de procedimentos + odontograma) */}
              {entry.teeth.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Dentes envolvidos
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.teeth.map((tooth) => {
                      const hasSurfaces = tooth.surfaces.length > 0
                      const label = hasSurfaces
                        ? `${tooth.toothNumber} • ${tooth.surfaces.join(", ")}`
                        : tooth.toothNumber
                      return onFilterTooth ? (
                        <button
                          key={tooth.toothNumber}
                          type="button"
                          onClick={() => onFilterTooth(tooth.toothNumber)}
                          title={`Ver evolução do dente ${tooth.toothNumber}`}
                          className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                        >
                          {label}
                        </button>
                      ) : (
                        <span
                          key={tooth.toothNumber}
                          className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700"
                        >
                          {label}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Resumo da evolução clínica (texto curto — nunca o registro todo) */}
              {summary && (
                <blockquote className="mt-3 border-l-2 border-gray-200 pl-3 text-sm italic text-gray-600">
                  “{summary.text}”
                </blockquote>
              )}

              {/* Avaliação / conduta resumidas */}
              {(entry.evaluation || entry.conduct) && (
                <dl className="mt-3 grid gap-1.5 text-xs text-gray-600 sm:grid-cols-2">
                  {entry.evaluation && (
                    <div>
                      <dt className="font-medium text-gray-500">Avaliação</dt>
                      <dd className="text-gray-700">{entry.evaluation}</dd>
                    </div>
                  )}
                  {entry.conduct && (
                    <div>
                      <dt className="font-medium text-gray-500">Conduta</dt>
                      <dd className="text-gray-700">{entry.conduct}</dd>
                    </div>
                  )}
                </dl>
              )}

              {/* Registro clínico ausente ou incompleto é explicitado */}
              {entry.kind === "incomplete" && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-orange-700">
                  <FileText className="h-3.5 w-3.5" />
                  Sem registro clínico estruturado — há procedimentos/eventos
                  registrados neste atendimento.
                </p>
              )}
            </>
          )}

          {/* Rodapé: auditoria + ação */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
            <span className="text-[11px] text-gray-400">
              {auditStamp
                ? `Registro criado em ${auditStamp}`
                : "Registro sem carimbo de criação"}
            </span>
            <button
              type="button"
              onClick={() => onOpenFull(entry)}
              className="rounded-md px-2 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50"
            >
              Ver atendimento completo
            </button>
          </div>
        </article>
      </div>
    </li>
  )
}

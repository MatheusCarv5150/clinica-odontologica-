"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import type { ClinicalAlert } from "@/lib/anamnesis-domain"

// ===========================================================================
// Blocos reutilizáveis da ANAMNESE (apresentação).
//
// Mantidos separados do componente principal para que as próximas partes do
// prontuário (Evolução, Plano) reutilizem a mesma linguagem visual — cards,
// seções expansíveis e alertas — sem recriar estilos.
// ===========================================================================

// ---------------------------------------------------------------------------
// Seção expansível (accordion acessível)
// ---------------------------------------------------------------------------

interface AnamnesisSectionCardProps {
  id: string
  title: string
  description?: string
  icon?: React.ReactNode
  // Destaque visual para blocos de segurança clínica (alergias).
  tone?: "default" | "critical"
  // Resumo curto exibido no cabeçalho quando recolhido.
  summary?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  isOpen: boolean
  onToggle: (id: string) => void
}

export function AnamnesisSectionCard({
  id,
  title,
  description,
  icon,
  tone = "default",
  summary,
  children,
  isOpen,
  onToggle,
}: AnamnesisSectionCardProps) {
  const headerId = `${id}-header`
  const panelId = `${id}-panel`
  const isCritical = tone === "critical"

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-white shadow-sm",
        isCritical ? "border-red-200 border-l-4 border-l-red-500" : "border-gray-200"
      )}
    >
      <h3>
        <button
          type="button"
          id={headerId}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => onToggle(id)}
          className={cn(
            "flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition-colors",
            isOpen ? "bg-gray-50/70" : "hover:bg-gray-50"
          )}
        >
          <span className="flex min-w-0 items-start gap-2.5">
            {icon && (
              <span
                className={cn(
                  "mt-0.5 shrink-0",
                  isCritical ? "text-red-600" : "text-blue-600"
                )}
              >
                {icon}
              </span>
            )}
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-sm font-semibold",
                  isCritical ? "text-red-900" : "text-gray-900"
                )}
              >
                {title}
              </span>
              {description && (
                <span className="mt-0.5 block text-xs font-normal text-gray-500">
                  {description}
                </span>
              )}
              {!isOpen && summary && (
                <span className="mt-1.5 block text-xs text-gray-600">{summary}</span>
              )}
            </span>
          </span>

          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 shrink-0 text-xs font-medium",
              isCritical ? "text-red-500" : "text-gray-400"
            )}
          >
            {isOpen ? "Recolher" : "Expandir"}
          </span>
        </button>
      </h3>

      {isOpen && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="border-t border-gray-100 px-4 py-4"
        >
          {children}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Alertas clínicos (destaque no topo da anamnese)
// ---------------------------------------------------------------------------

const ALERT_KIND_STYLES: Record<
  ClinicalAlert["kind"],
  { icon: string; bg: string; border: string; text: string }
> = {
  allergy: {
    icon: "⚠",
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-800",
  },
  condition: {
    icon: "⚠",
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-800",
  },
  medication: {
    icon: "💊",
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-800",
  },
  answer: {
    icon: "•",
    bg: "bg-gray-50",
    border: "border-gray-200",
    text: "text-gray-700",
  },
}

export function ClinicalAlertsPanel({ alerts }: { alerts: ClinicalAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
        <p className="text-sm font-semibold text-gray-500">Alertas clínicos</p>
        <p className="mt-0.5 text-xs text-gray-400">
          Não há alertas clínicos registrados.
        </p>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-red-200 bg-red-50/60 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-red-800">
        <span aria-hidden="true">⚠</span>
        Alertas clínicos
      </p>
      <p className="mt-0.5 text-[11px] text-red-700/80">
        Informações registradas no prontuário. O sistema apenas apresenta os dados
        informados — não gera diagnósticos.
      </p>

      <ul className="mt-3 space-y-1.5">
        {alerts.map((alert, index) => {
          const styles = ALERT_KIND_STYLES[alert.kind]
          return (
            <li
              key={`${alert.kind}-${alert.text}-${index}`}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2",
                styles.bg,
                styles.border
              )}
            >
              <span aria-hidden="true" className={cn("text-sm", styles.text)}>
                {styles.icon}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium", styles.text)}>
                  {alert.text}
                </span>
                {alert.detail && (
                  <span className="mt-0.5 block text-xs text-gray-600">
                    {alert.detail}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Estado vazio
// ---------------------------------------------------------------------------

export function AnamnesisEmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center">
      <p className="text-sm font-medium text-gray-700">
        Esta anamnese ainda não possui informações registradas.
      </p>
      <p className="mt-1 text-xs text-gray-400">
        Registre queixa, histórico clínico, alergias e demais informações do
        paciente.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
      >
        + Iniciar anamnese
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Esqueleto de carregamento
// ---------------------------------------------------------------------------

export function AnamnesisSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="h-4 w-40 animate-pulse rounded bg-gray-100" />
          <div className="mt-3 space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Controles de resposta Sim / Não / Não informado
// ---------------------------------------------------------------------------

export interface AnswerControlProps {
  value: string
  onChange: (value: "yes" | "no" | "unknown") => void
  name: string
}

const ANSWER_OPTIONS: Array<{ value: "yes" | "no" | "unknown"; label: string }> = [
  { value: "yes", label: "Sim" },
  { value: "no", label: "Não" },
  { value: "unknown", label: "Não sabe / Não informado" },
]

export function AnswerControl({ value, onChange, name }: AnswerControlProps) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5">
      {ANSWER_OPTIONS.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
              selected
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Campo de texto rotulado
// ---------------------------------------------------------------------------

export function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500"
    >
      {children}
      {hint && (
        <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">
          ({hint})
        </span>
      )}
    </label>
  )
}

export const textInputClass =
  "h-9 w-full rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"

export const textAreaClass =
  "w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"

// ---------------------------------------------------------------------------
// Linha de pergunta estruturada (Sim / Não / Não informado + observação)
// ---------------------------------------------------------------------------

export interface QuestionRowProps {
  question: { key: string; label: string; hint?: string }
  draft?: { value: string; note: string }
  onAnswer: (questionKey: string, value: "yes" | "no" | "unknown") => void
  onNote: (questionKey: string, note: string) => void
}

export function QuestionRow({
  question,
  draft,
  onAnswer,
  onNote,
}: QuestionRowProps) {
  const value = draft?.value ?? ""
  const note = draft?.note ?? ""
  const [showNote, setShowNote] = useState(note.length > 0)

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-gray-800">{question.label}</p>
          {question.hint && (
            <p className="mt-0.5 text-[11px] text-gray-400">{question.hint}</p>
          )}
        </div>

        <AnswerControl
          name={question.label}
          value={value}
          onChange={(next) => onAnswer(question.key, next)}
        />
      </div>

      {!showNote && value !== "" && (
        <button
          type="button"
          onClick={() => setShowNote(true)}
          className="mt-1.5 text-[11px] font-medium text-blue-700 hover:underline"
        >
          + Adicionar observação
        </button>
      )}

      {showNote && (
        <div className="mt-2">
          <input
            type="text"
            value={note}
            onChange={(e) => onNote(question.key, e.target.value)}
            placeholder="Observação complementar (opcional)"
            className={textInputClass}
          />
        </div>
      )}
    </div>
  )
}

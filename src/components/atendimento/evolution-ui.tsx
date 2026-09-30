"use client"

import { cn } from "@/lib/utils"

// ===========================================================================
// Blocos reutilizáveis da EVOLUÇÃO CLÍNICA (Parte 6).
//
// Mantidos separados do componente principal para que o painel de
// evolução reutilize a mesma linguagem visual da anamnese — cards,
// seções expansíveis e campos de texto — sem recriar estilos.
// ===========================================================================

// ---------------------------------------------------------------------------
// Seção expansível (accordion acessível)
// ---------------------------------------------------------------------------

interface EvolutionSectionCardProps {
  id: string
  title: string
  description?: string
  icon?: React.ReactNode
  tone?: "default" | "critical"
  summary?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  isOpen: boolean
  onToggle: (id: string) => void
}

export function EvolutionSectionCard({
  id,
  title,
  description,
  icon,
  tone = "default",
  summary,
  children,
  isOpen,
  onToggle,
}: EvolutionSectionCardProps) {
  const headerId = `${id}-header`
  const panelId = `${id}-panel`
  const isCritical = tone === "critical"

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-white shadow-sm",
        isCritical
          ? "border-l-4 border-l-red-500 border-red-200"
          : "border-gray-200"
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
                <span className="mt-1 block text-xs text-gray-400">
                  {summary}
                </span>
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
// Campo de texto livre (textarea)
// ---------------------------------------------------------------------------

interface FreeTextFieldProps {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  rows?: number
  disabled?: boolean
  required?: boolean
}

export function FreeTextField({
  label,
  description,
  value,
  onChange,
  placeholder,
  maxLength = 4000,
  rows = 3,
  disabled = false,
  required = false,
}: FreeTextFieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      {description && (
        <p className="text-xs text-gray-500">{description}</p>
      )}
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        className={cn(
          "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors",
          "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
          disabled && "cursor-not-allowed bg-gray-50 text-gray-500"
        )}
      />
      <p className="text-[11px] text-gray-400">
        {(value ?? "").length}/{maxLength}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Campo de texto simples (input)
// ---------------------------------------------------------------------------

interface SimpleTextFieldProps {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  disabled?: boolean
  required?: boolean
}

export function SimpleTextField({
  label,
  description,
  value,
  onChange,
  placeholder,
  maxLength = 1000,
  disabled = false,
  required = false,
}: SimpleTextFieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      {description && (
        <p className="text-xs text-gray-500">{description}</p>
      )}
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        className={cn(
          "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors",
          "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
          disabled && "cursor-not-allowed bg-gray-50 text-gray-500"
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seleção de dente (referência contextual)
// ---------------------------------------------------------------------------

interface ToothReferenceProps {
  toothNumber: string | null
  dentition: string | null
  surfaces: string[]
  onChange: (data: {
    toothNumber: string | null
    dentition: string | null
    surfaces: string[]
  }) => void
  disabled?: boolean
}

const DENTITIONS = [
  { value: "permanent", label: "Permanente" },
  { value: "deciduous", label: "Decídua" },
]

const SURFACE_OPTIONS = [
  { value: "M", label: "Mésial" },
  { value: "D", label: "Distal" },
  { value: "O", label: "Oclusal" },
  { value: "V", label: "Vestibular" },
  { value: "L", label: "Lingual" },
]

export function ToothReference({
  toothNumber,
  dentition,
  surfaces,
  onChange,
  disabled = false,
}: ToothReferenceProps) {
  function toggleSurface(surface: string) {
    const current = surfaces ?? []
    const next = current.includes(surface)
      ? current.filter((s) => s !== surface)
      : [...current, surface]
    onChange({ toothNumber, dentition, surfaces: next })
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-gray-500">Dente</label>
        <input
          type="text"
          value={toothNumber ?? ""}
          onChange={(e) => {
            const val = e.target.value.replace(/\D/g, "")
            onChange({
              toothNumber: val.length > 0 ? val : null,
              dentition,
              surfaces,
            })
          }}
          placeholder="Ex.: 26"
          maxLength={2}
          disabled={disabled}
          className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <select
          value={dentition ?? ""}
          onChange={(e) =>
            onChange({
              toothNumber,
              dentition: e.target.value || null,
              surfaces,
            })
          }
          disabled={disabled}
          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="">Dentição</option>
          {DENTITIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-gray-500">
          Superfícies
        </label>
        <div className="flex flex-wrap gap-1.5">
          {SURFACE_OPTIONS.map((s) => {
            const active = (surfaces ?? []).includes(s.value)
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => toggleSurface(s.value)}
                disabled={disabled}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                )}
              >
                {s.value} — {s.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status badge para procedimento
// ---------------------------------------------------------------------------

const PROCEDURE_STATUS_STYLES: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  performed: {
    bg: "bg-green-50",
    text: "text-green-800",
    border: "border-green-200",
  },
  planned: {
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
  },
  not_performed: {
    bg: "bg-gray-100",
    text: "text-gray-700",
    border: "border-gray-200",
  },
  cancelled: {
    bg: "bg-red-50",
    text: "text-red-800",
    border: "border-red-200",
  },
}

export function ProcedureStatusBadge({
  status,
}: {
  status: string
}) {
  const styles = PROCEDURE_STATUS_STYLES[status] ?? PROCEDURE_STATUS_STYLES.planned

  const labels: Record<string, string> = {
    performed: "Realizado",
    planned: "Planejado",
    not_performed: "Não realizado",
    cancelled: "Cancelado",
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        styles.bg,
        styles.text,
        styles.border
      )}
    >
      {labels[status] ?? status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Resumo do atendimento (compacto)
// ---------------------------------------------------------------------------

interface AttendanceSummaryProps {
  patientName: string
  age: number | null
  appointmentCode: string
  date: string
  time: string | null
  professionalName: string | null
  status: string
  proceduresScheduled: Array<{ id: string; name: string; quantity: number }>
}

export function AttendanceSummary({
  patientName,
  age,
  appointmentCode,
  date,
  time,
  professionalName,
  status,
  proceduresScheduled,
}: AttendanceSummaryProps) {
  const statusLabels: Record<string, string> = {
    in_progress: "Em atendimento",
    awaiting_attendance: "Aguardando atendimento",
    completed: "Concluído",
    paid: "Aguardando atendimento",
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Paciente
          </span>
          <span className="font-semibold text-gray-900">{patientName}</span>
          {age !== null && (
            <span className="ml-2 text-gray-500">
              ({age} {age === 1 ? "ano" : "anos"})
            </span>
          )}
        </div>

        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Atendimento
          </span>
          <span className="font-semibold text-gray-900">#{appointmentCode}</span>
        </div>

        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Data
          </span>
          <span className="font-medium text-gray-900">{date}</span>
          {time && (
            <span className="ml-2 text-gray-500">às {time}</span>
          )}
        </div>

        {professionalName && (
          <div>
            <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Profissional
            </span>
            <span className="font-medium text-gray-900">{professionalName}</span>
          </div>
        )}

        <div>
          <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Status
          </span>
          <span className="font-medium text-gray-900">
            {statusLabels[status] ?? status}
          </span>
        </div>
      </div>

      {proceduresScheduled.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Procedimentos agendados
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {proceduresScheduled.map((p) => (
              <span
                key={p.id}
                className="rounded-full bg-white border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700"
              >
                {p.name}
                {p.quantity > 1 ? ` ×${p.quantity}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lista de procedimentos realizados
// ---------------------------------------------------------------------------

interface ProcedureRecordListProps {
  procedures: Array<{
    id: string
    procedureId: string
    procedureNameSnapshot: string
    toothNumber: string | null
    dentition: string | null
    surfaces: string[]
    status: string
    material: string | null
    notes: string | null
    professionalName: string | null
    occurredAt: string
  }>
  onRemove?: (id: string) => void
  disabled?: boolean
}

export function ProcedureRecordList({
  procedures,
  onRemove,
  disabled = false,
}: ProcedureRecordListProps) {
  if (procedures.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        Nenhum procedimento registrado ainda.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {procedures.map((proc) => (
        <div
          key={proc.id}
          className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">
                {proc.procedureNameSnapshot}
              </span>
              <ProcedureStatusBadge status={proc.status} />
            </div>

            <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
              {proc.toothNumber && (
                <span>Dente {proc.toothNumber}</span>
              )}
              {proc.dentition && (
                <span>
                  {proc.dentition === "permanent" ? "Permanente" : "Decídua"}
                </span>
              )}
              {proc.surfaces && proc.surfaces.length > 0 && (
                <span>Superfície(s): {proc.surfaces.join(", ")}</span>
              )}
              {proc.material && (
                <span>Material: {proc.material}</span>
              )}
            </div>

            {proc.notes && (
              <p className="mt-1 text-xs text-gray-500">{proc.notes}</p>
            )}
          </div>

          {onRemove && !disabled && (
            <button
              type="button"
              onClick={() => onRemove(proc.id)}
              className="shrink-0 rounded-full bg-gray-100 p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
              aria-label={`Remover procedimento ${proc.procedureNameSnapshot}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Checkbox para intercorrências
// ---------------------------------------------------------------------------

interface IntercurrentToggleProps {
  hasIntercurrent: boolean
  description: string | null
  onHasIntercurrentChange: (value: boolean) => void
  onDescriptionChange: (value: string) => void
  disabled?: boolean
}

export function IntercurrentToggle({
  hasIntercurrent,
  description,
  onHasIntercurrentChange,
  onDescriptionChange,
  disabled = false,
}: IntercurrentToggleProps) {
  return (
    <div className="space-y-2.5">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={hasIntercurrent}
          onChange={(e) => onHasIntercurrentChange(e.target.checked)}
          disabled={disabled}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        Houve intercorrência
      </label>

      {hasIntercurrent && (
        <textarea
          value={description ?? ""}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Descreva a intercorrência..."
          rows={3}
          maxLength={2000}
          disabled={disabled}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      )}
    </div>
  )
}

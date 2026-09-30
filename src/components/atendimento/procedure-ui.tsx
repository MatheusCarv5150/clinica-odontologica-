"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import {
  type ProcedureComparisonResult,
  type ProcedureExecutionStatus,
  PROCEDURE_COMPARISON_META,
  PROCEDURE_STATUS_META,
} from "@/lib/procedure-execution-domain"
import {
  type Dentition,
  type ToothSurface,
  TOOTH_SURFACES,
  getSurfaceLabel,
  getToothDefinition,
  listTeeth,
} from "@/lib/tooth-catalog"

// ===========================================================================
// Blocos reutilizáveis dos PROCEDIMENTOS DO ATENDIMENTO (Parte 7).
//
// Mantidos separados do painel principal para reutilizar a mesma linguagem
// visual do restante do prontuário (odontograma/evolução) sem recriar estilos.
// As listas de dentes e superfícies vêm do CATÁLOGO ÚNICO (`tooth-catalog`),
// usado pelo odontograma — não existe um segundo cadastro de dentes.
// ===========================================================================

// ---------------------------------------------------------------------------
// Badge de status da execução
// ---------------------------------------------------------------------------

export function ProcedureStatusBadge({
  status,
  className,
}: {
  status: ProcedureExecutionStatus | string
  className?: string
}) {
  const meta =
    PROCEDURE_STATUS_META[status as ProcedureExecutionStatus] ??
    PROCEDURE_STATUS_META.pending

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        meta.className,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden="true" />
      {meta.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Badge da comparação previsto x realizado
// ---------------------------------------------------------------------------

export function ProcedureComparisonBadge({
  result,
}: {
  result: ProcedureComparisonResult
}) {
  const meta = PROCEDURE_COMPARISON_META[result]
  const tone =
    result === "performed_as_planned"
      ? "✓ "
      : result === "not_performed"
        ? "✕ "
        : result === "added_in_attendance"
          ? "+ "
          : ""

  return (
    <span
      title={meta.description}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        meta.className
      )}
    >
      {tone}
      {meta.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Seleção de dente (reutiliza a estrutura do odontograma)
// ---------------------------------------------------------------------------

interface ToothSurfacePickerProps {
  dentition: Dentition
  toothNumber: string | null
  surfaces: string[]
  onDentitionChange: (dentition: Dentition) => void
  onToothChange: (toothNumber: string | null) => void
  onSurfacesChange: (surfaces: string[]) => void
  disabled?: boolean
}

// Seletor de dente + superfície. Mostra a dentição compatível com o
// odontograma (permanente/decídua) e as superfícies clínicas do catálogo único.
export function ToothSurfacePicker({
  dentition,
  toothNumber,
  surfaces,
  onDentitionChange,
  onToothChange,
  onSurfacesChange,
  disabled = false,
}: ToothSurfacePickerProps) {
  const teeth = useMemo(() => listTeeth(dentition), [dentition])

  // Rótulos adaptados ao dente selecionado (em anteriores, "O" é Incisal).
  const surfaceLabels = useMemo(() => {
    const tooth = toothNumber ? getToothDefinition(toothNumber) : null
    return TOOTH_SURFACES.map((surface) => ({
      surface,
      label: getSurfaceLabel(
        surface,
        tooth?.type ?? "first_molar"
      ),
    }))
  }, [toothNumber])

  function toggleSurface(surface: ToothSurface) {
    const next = surfaces.includes(surface)
      ? surfaces.filter((s) => s !== surface)
      : [...surfaces, surface]
    onSurfacesChange(next)
  }

  return (
    <div className="space-y-4">
      {/* Dentição */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-gray-500">Dentição</p>
        <div className="flex gap-2">
          {(
            [
              { value: "permanent", label: "Permanente" },
              { value: "deciduous", label: "Decídua" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => {
                onDentitionChange(option.value)
                // Troca de dentição invalida o dente selecionado.
                onToothChange(null)
              }}
              aria-pressed={dentition === option.value}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                dentition === option.value
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-200 text-gray-600 hover:bg-gray-100",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dentes */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-gray-500">Dente (opcional)</p>
          {toothNumber && !disabled && (
            <button
              type="button"
              onClick={() => {
                onToothChange(null)
                onSurfacesChange([])
              }}
              className="text-[11px] font-medium text-blue-700 hover:underline"
            >
              Remover dente
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-gray-200 p-2.5">
          {teeth.map((tooth) => (
            <button
              key={tooth.number}
              type="button"
              disabled={disabled}
              onClick={() =>
                onToothChange(toothNumber === tooth.number ? null : tooth.number)
              }
              aria-pressed={toothNumber === tooth.number}
              title={
                toothNumber === tooth.number
                  ? `Dente ${tooth.number} selecionado`
                  : `Selecionar dente ${tooth.number}`
              }
              className={cn(
                "h-9 w-9 rounded-lg border text-xs font-semibold tabular-nums transition-colors",
                toothNumber === tooth.number
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-200 text-gray-700 hover:bg-gray-100",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {tooth.number}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-gray-500">
          {toothNumber
            ? `Dente selecionado: ${toothNumber}`
            : "Sem dente — procedimentos como profilaxia não exigem dente."}
        </p>
      </div>

      {/* Superfícies (somente quando há dente) */}
      {toothNumber && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">
            Superfícies (opcional)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {surfaceLabels.map(({ surface, label }) => (
              <button
                key={surface}
                type="button"
                disabled={disabled}
                onClick={() => toggleSurface(surface)}
                aria-pressed={surfaces.includes(surface)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  surfaces.includes(surface)
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-200 text-gray-700 hover:bg-gray-100",
                  disabled && "cursor-not-allowed opacity-50"
                )}
              >
                {surface}
                <span className="ml-1.5 font-normal opacity-80">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formatação de valores
// ---------------------------------------------------------------------------

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  })
}

export function formatDateTime(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

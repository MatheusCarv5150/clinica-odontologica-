"use client"

import { cn } from "@/lib/utils"
import {
  type ToothDefinition,
  type ToothSurface,
  TOOTH_TYPE_LABELS,
  getSurfaceLabel,
  isAnteriorTooth,
} from "@/lib/tooth-catalog"
import { getToothVisual } from "@/lib/odontogram-domain"

// ===========================================================================
// Representação VISUAL de um dente (Parte 5 — Odontograma).
//
// O desenho é apenas a representação dos DADOS: cada região colorida
// corresponde a uma superfície com condição registrada. Não há "pintura
// manual" — o usuário clica para abrir o detalhe e registra dados clínicos.
//
// A forma do dente muda conforme o TIPO (incisivo, canino, molar), tornando o
// odontograma clinicamente legível em vez de uma grade de quadrados.
// ===========================================================================

export interface SurfaceCondition {
  surface: ToothSurface
  code: string
}

interface ToothGlyphProps {
  tooth: ToothDefinition
  // Estado atual do dente (código de condição principal).
  status: string
  // Superfícies com condição ativa, para colorir as regiões corretas.
  surfaceConditions: SurfaceCondition[]
  selected?: boolean
  dimmed?: boolean
  hasCurrentEvent?: boolean
  // Existe tratamento PLANEJADO (Parte 10.1) para este dente. É apenas um
  // indicador visual: NÃO representa estado clínico (PLANEJADO ≠ REALIZADO).
  hasPlannedTreatment?: boolean
  onSelect?: (number: string) => void
  disabled?: boolean
}

// Contornos por tipo de dente. As superfícies são desenhadas dentro do
// contorno, então o formato acompanha a anatomia.
function ToothOutline({ type }: { type: ToothDefinition["type"] }) {
  switch (type) {
    case "central_incisor":
      return (
        <path
          d="M9 3h14c1.1 0 2 .9 2 2v10c0 5-4 9-9 9s-9-4-9-9V5c0-1.1.9-2 2-2Z"
          className="fill-white"
        />
      )
    case "lateral_incisor":
      return (
        <path
          d="M10 3h12c1.1 0 2 .9 2 2v9.5c0 4.7-3.6 8.5-8 8.5s-8-3.8-8-8.5V5c0-1.1.9-2 2-2Z"
          className="fill-white"
        />
      )
    case "canine":
      return (
        <path
          d="M16 2c4 0 7 3.2 7 8.5 0 6-4.5 11.5-7 11.5S9 16.5 9 10.5C9 5.2 12 2 16 2Z"
          className="fill-white"
        />
      )
    case "first_premolar":
    case "second_premolar":
      return (
        <path
          d="M8 5c0-1.7 1.3-3 3-3h10c1.7 0 3 1.3 3 3v9c0 5-3.6 9-8 9s-8-4-8-9V5Z"
          className="fill-white"
        />
      )
    case "third_molar":
      return (
        <path
          d="M7 6c0-2.2 1.8-4 4-4h10c2.2 0 4 1.8 4 4v8c0 6-4 10-9 10s-9-4-9-10V6Z"
          className="fill-white"
        />
      )
    case "first_molar":
    case "second_molar":
    default:
      return (
        <path
          d="M7 5c0-2.2 1.8-4 4-4h10c2.2 0 4 1.8 4 4v9c0 6-4 10-9 10S7 20 7 14V5Z"
          className="fill-white"
        />
      )
  }
}

// Regiões das superfícies dentro do contorno. Oclusal (O) é o centro; as
// demais ficam nas bordas. Em dentes anteriores rotulamos "O" como Incisal.
function SurfaceRegions({
  type,
  conditions,
}: {
  type: ToothDefinition["type"]
  conditions: Map<ToothSurface, string>
}) {
  const anterior = isAnteriorTooth(type)

  const regions: Array<{
    surface: ToothSurface
    d: string
  }> = [
    // Oclusal / Incisal — centro do dente.
    {
      surface: "O",
      d: anterior
        ? "M11 6h10c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H11c-.6 0-1-.4-1-1V7c0-.6.4-1 1-1Z"
        : "M11 7h10c.6 0 1 .4 1 1v8c0 .6-.4 1-1 1H11c-.6 0-1-.4-1-1V8c0-.6.4-1 1-1Z",
    },
    // Mesial — borda esquerda (em direção à linha média).
    {
      surface: "M",
      d: anterior
        ? "M7 5h4v16H7c-.6 0-1-.4-1-1V6c0-.6.4-1 1-1Z"
        : "M7 6h4v14H7c-.6 0-1-.4-1-1V7c0-.6.4-1 1-1Z",
    },
    // Distal — borda direita.
    {
      surface: "D",
      d: anterior
        ? "M21 5h4c.6 0 1 .4 1 1v14c0 .6-.4 1-1 1h-4V5Z"
        : "M21 6h4c.6 0 1 .4 1 1v12c0 .6-.4 1-1 1h-4V6Z",
    },
    // Vestibular — faixa superior.
    {
      surface: "V",
      d: anterior
        ? "M7 5c0-.6.4-1 1-1h16c.6 0 1 .4 1 1v6H7V5Z"
        : "M7 6c0-2.2 1.8-4 4-4h10c2.2 0 4 1.8 4 4v3H7V6Z",
    },
    // Lingual / Palatina — faixa inferior.
    {
      surface: "L",
      d: anterior
        ? "M7 19h18v3c0 .6-.4 1-1 1H8c-.6 0-1-.4-1-1v-3Z"
        : "M7 17h18v4c0 .6-.4 1-1 1H8c-.6 0-1-.4-1-1v-4Z",
    },
  ]

  return (
    <>
      <ToothOutline type={type} />
      {regions.map((region) => {
        const code = conditions.get(region.surface)
        const visual = code ? getToothVisual(code) : null
        return (
          <path
            key={region.surface}
            d={region.d}
            className={cn(
              "transition-colors",
              visual ? visual.surfaceFill : "fill-transparent stroke-transparent"
            )}
          >
            <title>
              {getSurfaceLabel(region.surface, type)}
              {code ? ` — ${code}` : ""}
            </title>
          </path>
        )
      })}
    </>
  )
}

export function ToothGlyph({
  tooth,
  status,
  surfaceConditions,
  selected = false,
  dimmed = false,
  hasCurrentEvent = false,
  hasPlannedTreatment = false,
  onSelect,
  disabled = false,
}: ToothGlyphProps) {
  const visual = getToothVisual(status)
  const conditions = new Map(surfaceConditions.map((s) => [s.surface, s.code]))
  const isAbsent = status === "absent" || status === "extracted"

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect?.(tooth.number)}
      aria-label={`Dente ${tooth.number} — ${
        status === "healthy" ? "saudável" : status
      }${hasPlannedTreatment ? " • tratamento planejado" : ""}`}
      aria-pressed={selected}
      title={`Dente ${tooth.number} • ${TOOTH_TYPE_LABELS[tooth.type]}${
        hasPlannedTreatment ? " • tratamento planejado" : ""
      }`}
      className={cn(
        "group relative flex flex-col items-center gap-0.5 rounded-lg p-1 transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1",
        disabled ? "cursor-default" : "cursor-pointer hover:bg-gray-50",
        dimmed && "opacity-35",
        selected && "bg-blue-50 ring-2 ring-blue-500"
      )}
    >
      <svg
        viewBox="0 0 32 28"
        className={cn(
          "h-9 w-9 shrink-0 drop-shadow-sm transition-transform sm:h-10 sm:w-10",
          !disabled && "group-hover:scale-105"
        )}
        role="img"
        aria-hidden="true"
      >
        {isAbsent ? (
          <>
            {/* Ausente/extraído: contorno + X clínico, sem regiões de
                superfície (não há estrutura a representar). */}
            <ToothOutline type={tooth.type} />
            <path
              d="M10 8l12 12M22 8L10 20"
              className="stroke-gray-500"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </>
        ) : (
          /* Regiões das superfícies já incluem o fundo branco do dente; o
             contorno é desenhado por cima logo abaixo. */
          <SurfaceRegions type={tooth.type} conditions={conditions} />
        )}

        {/* Contorno externo (não preenchido) — define a forma e destaca a
            seleção sem cobrir as cores das superfícies. */}
        <path
          d={outlinePath(tooth.type)}
          className={cn(
            "fill-none",
            selected ? "stroke-blue-600" : "stroke-gray-400",
            "group-hover:stroke-gray-600"
          )}
          strokeWidth={selected ? 1.6 : 1}
        />
      </svg>

      {/* Número FDI — sempre visível e legível. */}
      <span
        className={cn(
          "text-[11px] font-semibold tabular-nums leading-none",
          selected ? "text-blue-700" : "text-gray-600"
        )}
      >
        {tooth.number}
      </span>

      {/* Indicador de registro feito NESTE atendimento. */}
      {hasCurrentEvent && (
        <span
          className={cn(
            "absolute right-0.5 top-0.5 h-2 w-2 rounded-full ring-2 ring-white",
            visual.dot
          )}
          aria-hidden="true"
        />
      )}

      {/* Indicador de tratamento PLANEJADO (Parte 10.1). Não é estado clínico:
          apenas sinaliza que existe um item aberto no plano de tratamento
          para este dente. */}
      {hasPlannedTreatment && (
        <span
          className="absolute left-0.5 top-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-indigo-600 ring-2 ring-white"
          title="Tratamento planejado para este dente"
          aria-hidden="true"
        />
      )}
    </button>
  )
}

// Caminho do contorno por tipo — reutilizado para o stroke externo.
function outlinePath(type: ToothDefinition["type"]): string {
  switch (type) {
    case "central_incisor":
      return "M9 3h14c1.1 0 2 .9 2 2v10c0 5-4 9-9 9s-9-4-9-9V5c0-1.1.9-2 2-2Z"
    case "lateral_incisor":
      return "M10 3h12c1.1 0 2 .9 2 2v9.5c0 4.7-3.6 8.5-8 8.5s-8-3.8-8-8.5V5c0-1.1.9-2 2-2Z"
    case "canine":
      return "M16 2c4 0 7 3.2 7 8.5 0 6-4.5 11.5-7 11.5S9 16.5 9 10.5C9 5.2 12 2 16 2Z"
    case "first_premolar":
    case "second_premolar":
      return "M8 5c0-1.7 1.3-3 3-3h10c1.7 0 3 1.3 3 3v9c0 5-3.6 9-8 9s-8-4-8-9V5Z"
    case "third_molar":
      return "M7 6c0-2.2 1.8-4 4-4h10c2.2 0 4 1.8 4 4v8c0 6-4 10-9 10s-9-4-9-10V6Z"
    default:
      return "M7 5c0-2.2 1.8-4 4-4h10c2.2 0 4 1.8 4 4v9c0 6-4 10-9 10S7 20 7 14V5Z"
  }
}

"use client"

import { useEffect, useState } from "react"
import { Filter, Search, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  TIMELINE_PERIODS,
  type TimelineFiltersMeta,
  type TimelinePeriod,
} from "@/lib/evolution-timeline"

// ===========================================================================
// Filtros da EVOLUÇÃO CLÍNICA (Parte 8).
//
// Todos os filtros são resolvidos no BACKEND: o componente apenas monta o
// estado e devolve para a tela. Nenhum registro é carregado inteiro para ser
// filtrado no navegador.
//
// Filtros suportados:
//   - período (todo / 30 dias / 6 meses / 1 ano / personalizado)
//   - profissional (somente quando há mais de um)
//   - procedimento (apenas os que o paciente possui)
//   - dente (visão longitudinal do dente)
//   - busca textual
//   - ordenação (mais recente / mais antigo)
// ===========================================================================

export interface TimelineFilterState {
  period: TimelinePeriod
  from: string
  to: string
  professional: string
  procedure: string
  tooth: string
  query: string
  sort: "desc" | "asc"
  includeNonClinical: boolean
}

export const EMPTY_FILTERS: TimelineFilterState = {
  period: "all",
  from: "",
  to: "",
  professional: "",
  procedure: "",
  tooth: "",
  query: "",
  sort: "desc",
  includeNonClinical: false,
}

interface TimelineFiltersProps {
  filters: TimelineFiltersMeta
  value: TimelineFilterState
  onChange: (next: TimelineFilterState) => void
}

export function TimelineFilters({
  filters,
  value,
  onChange,
}: TimelineFiltersProps) {
  // A busca textual é debounced localmente para não disparar uma consulta por
  // tecla digitada (a busca real acontece no backend).
  const [queryDraft, setQueryDraft] = useState(value.query)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (queryDraft !== value.query) {
        onChange({ ...value, query: queryDraft })
      }
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft])

  // Sincroniza quando o filtro é limpo externamente (ex.: botão "Limpar").
  useEffect(() => {
    if (value.query === "") {
      const id = requestAnimationFrame(() => setQueryDraft(""))
      return () => cancelAnimationFrame(id)
    }
  }, [value.query])

  const hasProfessionals = filters.professionals.length > 1
  const hasProcedures = filters.procedures.length > 0
  const hasTeeth = filters.teeth.length > 0

  const hasActiveFilters =
    value.period !== "all" ||
    !!value.from ||
    !!value.to ||
    !!value.professional ||
    !!value.procedure ||
    !!value.tooth ||
    !!value.query ||
    value.includeNonClinical ||
    value.sort !== "desc"

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3.5">
      {/* Linha 1: busca + ordenação */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Pesquisar por queixa, avaliação, conduta, procedimento, dente..."
            value={queryDraft}
            onChange={(e) => setQueryDraft(e.target.value)}
            className="pl-9"
            aria-label="Pesquisar na evolução clínica"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ ...value, sort: "desc" })}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              value.sort === "desc"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-200 text-gray-600 hover:bg-gray-100"
            )}
          >
            Mais recente
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...value, sort: "asc" })}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              value.sort === "asc"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-200 text-gray-600 hover:bg-gray-100"
            )}
          >
            Mais antigo
          </button>
        </div>

        {hasActiveFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQueryDraft("")
              onChange(EMPTY_FILTERS)
            }}
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Linha 2: período */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          <SlidersHorizontal className="h-3 w-3" />
          Período
        </span>
        {TIMELINE_PERIODS.map((period) => (
          <button
            key={period.value}
            type="button"
            onClick={() =>
              onChange({
                ...value,
                period: period.value,
                // Ao sair do personalizado, limpa as datas para não deixar
                // um intervalo "fantasma" aplicado.
                from: period.value === "custom" ? value.from : "",
                to: period.value === "custom" ? value.to : "",
              })
            }
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              value.period === period.value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-200 text-gray-600 hover:bg-gray-100"
            )}
          >
            {period.label}
          </button>
        ))}

        {value.period === "custom" && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={value.from}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className="w-[150px]"
              aria-label="Data inicial"
            />
            <span className="text-xs text-gray-400">até</span>
            <Input
              type="date"
              value={value.to}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className="w-[150px]"
              aria-label="Data final"
            />
          </div>
        )}
      </div>

      {/* Linha 3: profissional + procedimento + dente */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Filter className="h-3.5 w-3.5 shrink-0 text-gray-400" />

        {hasProfessionals && (
          <select
            value={value.professional}
            onChange={(e) =>
              onChange({ ...value, professional: e.target.value })
            }
            className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
            aria-label="Filtrar por profissional"
          >
            <option value="">Todos os profissionais</option>
            {filters.professionals.map((professional) => (
              <option key={professional.id} value={professional.id}>
                {professional.name}
              </option>
            ))}
          </select>
        )}

        {hasProcedures && (
          <select
            value={value.procedure}
            onChange={(e) => onChange({ ...value, procedure: e.target.value })}
            className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
            aria-label="Filtrar por procedimento"
          >
            <option value="">Todos os procedimentos</option>
            {filters.procedures.map((procedure) => (
              <option key={procedure.id} value={procedure.id}>
                {procedure.name}
              </option>
            ))}
          </select>
        )}

        {hasTeeth && (
          <select
            value={value.tooth}
            onChange={(e) => onChange({ ...value, tooth: e.target.value })}
            className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
            aria-label="Filtrar por dente"
          >
            <option value="">Todos os dentes</option>
            {filters.teeth.map((tooth) => (
              <option key={tooth} value={tooth}>
                Dente {tooth}
              </option>
            ))}
          </select>
        )}

        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={value.includeNonClinical}
            onChange={(e) =>
              onChange({ ...value, includeNonClinical: e.target.checked })
            }
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Incluir cancelados e não comparecimentos
        </label>
      </div>
    </div>
  )
}

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  AlertTriangle,
  Check,
  Loader2,
  Search,
  Stethoscope,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  groupConditionsByCategory,
  getCondition,
} from "@/lib/odontogram-domain"
import {
  type ToothSurface,
  TOOTH_SURFACES,
  getSurfaceLabel,
  getToothDefinition,
  listTeeth,
  type Dentition,
} from "@/lib/tooth-catalog"

// ===========================================================================
// REGISTRO NO ODONTOGRAMA (Parte 5).
//
// Um único fluxo para registrar CONDIÇÃO ou PROCEDIMENTO — conceitos
// diferentes, entidades diferentes no banco.
//
// - PROCEDIMENTO reutiliza o catálogo REAL de procedimentos (via API),
//   com busca e snapshot. Não existe segundo catálogo.
// - CONDIÇÃO vem do catálogo de domínio.
// - Dentes: seleção individual, múltipla, por arcada ou todos.
// - Superfícies: seleção específica (M, D, O, V, L).
// ===========================================================================

interface ProcedureOption {
  id: string
  name: string
  code: string
  category: string
  defaultPrice: number | null
  active: boolean
}

interface OdontogramEventModalProps {
  attendanceId: string
  dentition: Dentition
  // Dente pré-selecionado quando aberto a partir do detalhe.
  initialTooth?: string | null
  canEdit: boolean
  onClose: () => void
  onSaved: (message: string) => void
}

type Kind = "condition" | "procedure"

export function OdontogramEventModal({
  attendanceId,
  dentition,
  initialTooth,
  canEdit,
  onClose,
  onSaved,
}: OdontogramEventModalProps) {
  const [kind, setKind] = useState<Kind>("condition")
  const [conditionCode, setConditionCode] = useState<string>("")
  const [selectedTeeth, setSelectedTeeth] = useState<string[]>(
    initialTooth ? [initialTooth] : []
  )
  const [surfaces, setSurfaces] = useState<ToothSurface[]>([])
  const [notes, setNotes] = useState("")
  // Profissional responsável pelo registro. O sistema ainda não possui
  // relação com usuários logados; guardamos o nome informado (mesma
  // abordagem usada na anamnese), garantindo a rastreabilidade clínica.
  const [professionalName, setProfessionalName] = useState("")
  const [procedureStatus, setProcedureStatus] = useState<"performed" | "planned">(
    "performed"
  )

  // Procedimentos (catálogo existente)
  const [procedures, setProcedures] = useState<ProcedureOption[]>([])
  const [isLoadingProcedures, setIsLoadingProcedures] = useState(false)
  const [procedureQuery, setProcedureQuery] = useState("")
  const [procedureId, setProcedureId] = useState<string>("")

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  const teeth = useMemo(() => listTeeth(dentition), [dentition])
  const selectedCondition = conditionCode ? getCondition(conditionCode) : null

  // Carrega procedimentos do catálogo REAL somente quando necessário.
  // O setState acontece APÓS o await, nunca de forma síncrona no corpo do effect.
  useEffect(() => {
    if (kind !== "procedure" || procedures.length > 0) return
    let cancelled = false
    fetch("/api/procedures")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled) return
        setProcedures(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setProcedures([])
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProcedures(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, procedures.length])

  // Fecha com ESC
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const filteredProcedures = useMemo(() => {
    const query = procedureQuery.trim().toLowerCase()
    if (!query) return procedures.slice(0, 40)
    return procedures
      .filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.code.toLowerCase().includes(query)
      )
      .slice(0, 40)
  }, [procedures, procedureQuery])

  const toggleTooth = useCallback((number: string) => {
    setSelectedTeeth((current) =>
      current.includes(number)
        ? current.filter((n) => n !== number)
        : [...current, number]
    )
  }, [])

  const selectArch = useCallback(
    (arch: "upper" | "lower") => {
      const numbers = teeth.filter((t) => t.arch === arch).map((t) => t.number)
      setSelectedTeeth((current) => {
        const allSelected = numbers.every((n) => current.includes(n))
        return allSelected
          ? current.filter((n) => !numbers.includes(n))
          : Array.from(new Set([...current, ...numbers]))
      })
    },
    [teeth]
  )

  const selectAll = useCallback(() => {
    const numbers = teeth.map((t) => t.number)
    setSelectedTeeth((current) =>
      current.length === numbers.length ? [] : numbers
    )
  }, [teeth])

  function toggleSurface(surface: ToothSurface) {
    setSurfaces((current) =>
      current.includes(surface)
        ? current.filter((s) => s !== surface)
        : [...current, surface]
    )
  }

  // Superfícies adaptadas: em dentes anteriores a face "O" é "Incisal".
  const surfaceLabels = useMemo(() => {
    const firstTooth = selectedTeeth[0]
      ? getToothDefinition(selectedTeeth[0])
      : null
    return TOOTH_SURFACES.map((surface) => ({
      surface,
      label: firstTooth
        ? getSurfaceLabel(surface, firstTooth.type)
        : getSurfaceLabel(surface, "first_molar"),
    }))
  }, [selectedTeeth])

  // Validação local (o backend é a autoridade final).
  const validationMessage = useMemo(() => {
    if (!canEdit) return "O atendimento precisa estar em andamento."
    if (selectedTeeth.length === 0) return "Selecione ao menos um dente."
    if (kind === "condition") {
      if (!conditionCode) return "Selecione a condição."
      if (selectedCondition?.requiresSurface && surfaces.length === 0)
        return `A condição "${selectedCondition.name}" exige ao menos uma superfície.`
      if (selectedTeeth.length > 1 && selectedCondition && !selectedCondition.allowMultipleTeeth)
        return `A condição "${selectedCondition.name}" não pode ser aplicada a vários dentes de uma vez.`
    }
    if (kind === "procedure" && !procedureId) return "Selecione o procedimento."
    return ""
  }, [canEdit, selectedTeeth, kind, conditionCode, surfaces, selectedCondition, procedureId])

  async function handleSave() {
    if (validationMessage) {
      setError(validationMessage)
      return
    }

    setIsSaving(true)
    setError("")
    try {
      const payload =
        kind === "condition"
          ? {
              kind,
              code: conditionCode,
              toothNumbers: selectedTeeth,
              dentition,
              surfaces,
              notes: notes || null,
              professionalName: professionalName || null,
            }
          : {
              kind,
              procedureId,
              toothNumbers: selectedTeeth,
              dentition,
              surfaces,
              status: procedureStatus,
              notes: notes || null,
              professionalName: professionalName || null,
            }

      const res = await fetch(`/api/attendance/${attendanceId}/odontogram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const data = await res.json()
        const label =
          kind === "condition"
            ? selectedCondition?.name ?? "Condição"
            : procedures.find((p) => p.id === procedureId)?.name ?? "Procedimento"
        onSaved(
          `${label} registrado em ${data.created} ${data.created === 1 ? "dente" : "dentes"}.`
        )
        return
      }

      const err = await res.json().catch(() => ({}))
      const detail = Array.isArray(err.details) && err.details[0]?.message
      setError(err.error || detail || "Não foi possível registrar.")
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-gray-900/30"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Registrar no odontograma"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              Registrar no odontograma
            </h2>
            <p className="text-xs text-gray-500">
              Condição e procedimento são registros diferentes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Tipo de registro */}
          <div className="mb-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKind("condition")}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                kind === "condition"
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:bg-gray-50"
              )}
            >
              <span className="block text-sm font-semibold text-gray-900">
                Condição
              </span>
              <span className="mt-0.5 block text-[11px] text-gray-500">
                O que foi encontrado (ex.: cárie)
              </span>
            </button>
            <button
              type="button"
              onClick={() => setKind("procedure")}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                kind === "procedure"
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:bg-gray-50"
              )}
            >
              <span className="block text-sm font-semibold text-gray-900">
                Procedimento
              </span>
              <span className="mt-0.5 block text-[11px] text-gray-500">
                O que foi feito / planejado
              </span>
            </button>
          </div>

          {/* Seleção da condição */}
          {kind === "condition" && (
            <section className="mb-5">
              <FieldLabel>Condição</FieldLabel>
              <div className="max-h-56 space-y-3 overflow-y-auto rounded-lg border border-gray-200 p-3">
                {groupConditionsByCategory().map((group) => (
                  <div key={group.category}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      {group.label}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.conditions
                        .filter((c) => c.code !== "healthy")
                        .map((condition) => (
                          <button
                            key={condition.code}
                            type="button"
                            onClick={() => setConditionCode(condition.code)}
                            title={condition.description}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                              conditionCode === condition.code
                                ? "border-blue-600 bg-blue-600 text-white"
                                : "border-gray-200 text-gray-700 hover:bg-gray-100"
                            )}
                          >
                            {condition.name}
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
              {selectedCondition && (
                <p className="mt-1.5 text-[11px] text-gray-500">
                  {selectedCondition.description}
                </p>
              )}
            </section>
          )}

          {/* Seleção do procedimento (catálogo REAL) */}
          {kind === "procedure" && (
            <section className="mb-5">
              <FieldLabel>Procedimento</FieldLabel>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Buscar no catálogo de procedimentos..."
                  value={procedureQuery}
                  onChange={(e) => setProcedureQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {isLoadingProcedures ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando procedimentos...
                </div>
              ) : filteredProcedures.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500">
                  Nenhum procedimento encontrado. Cadastre em Procedimentos.
                </p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  {filteredProcedures.map((procedure) => (
                    <li key={procedure.id}>
                      <button
                        type="button"
                        onClick={() => setProcedureId(procedure.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                          procedureId === procedure.id
                            ? "bg-blue-50 text-blue-900"
                            : "hover:bg-gray-50"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Stethoscope className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {procedure.name}
                            </span>
                            <span className="block text-[11px] text-gray-500">
                              {procedure.code} • {procedure.category}
                            </span>
                          </span>
                        </span>
                        {procedureId === procedure.id && (
                          <Check className="h-4 w-4 shrink-0 text-blue-600" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* PLANEJADO x REALIZADO */}
              <div className="mt-3">
                <FieldLabel>Status</FieldLabel>
                <div className="flex gap-2">
                  {(
                    [
                      { value: "performed", label: "Realizado" },
                      { value: "planned", label: "Planejado" },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setProcedureStatus(option.value)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        procedureStatus === option.value
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-200 text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-gray-500">
                  O planejado não é confundido com o executado: ele permanece no
                  histórico até ser marcado como realizado.
                </p>
              </div>
            </section>
          )}

          {/* Superfícies */}
          <section className="mb-5">
            <div className="flex items-center justify-between">
              <FieldLabel>Superfícies</FieldLabel>
              <span className="text-[11px] text-gray-400">
                {surfaces.length === 0
                  ? "Dente como um todo"
                  : `${surfaces.length} selecionada(s)`}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {surfaceLabels.map(({ surface, label }) => (
                <button
                  key={surface}
                  type="button"
                  onClick={() => toggleSurface(surface)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    surfaces.includes(surface)
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-200 text-gray-700 hover:bg-gray-100"
                  )}
                >
                  {surface}
                  <span className="ml-1.5 font-normal opacity-80">{label}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">
              Uma condição na superfície Mesial não altera as demais. Registre
              separadamente o que estiver em cada superfície.
            </p>
          </section>

          {/* Dentes */}
          <section className="mb-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldLabel>Dentes</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => selectArch("upper")}
                  className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
                >
                  Arcada superior
                </button>
                <button
                  type="button"
                  onClick={() => selectArch("lower")}
                  className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
                >
                  Arcada inferior
                </button>
                <button
                  type="button"
                  onClick={selectAll}
                  className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
                >
                  {selectedTeeth.length === teeth.length ? "Limpar" : "Todos"}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 rounded-lg border border-gray-200 p-2.5">
              {teeth.map((tooth) => (
                <button
                  key={tooth.number}
                  type="button"
                  onClick={() => toggleTooth(tooth.number)}
                  className={cn(
                    "h-9 w-9 rounded-lg border text-xs font-semibold tabular-nums transition-colors",
                    selectedTeeth.includes(tooth.number)
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-200 text-gray-700 hover:bg-gray-100"
                  )}
                >
                  {tooth.number}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">
              {selectedTeeth.length === 0
                ? "Nenhum dente selecionado."
                : `Selecionados: ${selectedTeeth.join(", ")}`}
            </p>
          </section>

          {/* Profissional responsável + Observações */}
          <section className="space-y-3">
            <div>
              <FieldLabel>Profissional responsável</FieldLabel>
              <Input
                value={professionalName}
                onChange={(e) => setProfessionalName(e.target.value)}
                maxLength={120}
                placeholder="Nome do profissional que realizou o registro"
              />
              <p className="mt-1 text-[11px] text-gray-500">
                Fica gravado no histórico clínico junto com o atendimento.
              </p>
            </div>

            <div>
              <FieldLabel>Observações</FieldLabel>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Ex.: Restauração em resina composta."
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </section>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {!canEdit && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              O atendimento precisa estar em andamento para registrar.
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
          <Badge className="border-gray-200 bg-gray-50 text-gray-600">
            {kind === "condition" ? "Condição" : "Procedimento"}
          </Badge>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !!validationMessage || !canEdit}
              title={validationMessage || undefined}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Registrando...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Registrar
                </>
              )}
            </Button>
          </div>
        </footer>
      </div>
    </>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
      {children}
    </p>
  )
}

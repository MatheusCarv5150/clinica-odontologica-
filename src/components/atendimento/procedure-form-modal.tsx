"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  PROCEDURE_REASONS,
  type ProcedureExecutionStatus,
} from "@/lib/procedure-execution-domain"
import { type Dentition } from "@/lib/tooth-catalog"
import { ToothSurfacePicker, formatCurrency } from "./procedure-ui"

// ===========================================================================
// REGISTRAR / MARCAR PROCEDIMENTO (Parte 7).
//
// Um único formulário contextual atende os dois fluxos:
//   - Registrar procedimento REALIZADO (dente, superfície, valor, observação);
//   - Marcar como NÃO REALIZADO (motivo controlado + observação livre).
//
// O backend é a autoridade final:
//   - valida se o procedimento permite alteração de valor;
//   - grava o snapshot do catálogo;
//   - gera o evento no ODONTOGRAMA quando há dente e a execução é realizada.
// ===========================================================================

export interface ProcedureFormTarget {
  // Execução já existente (marcar como realizado/não realizado) ou null
  // (adicionar um procedimento novo durante o atendimento).
  executionId: string | null
  procedureId: string
  procedureName: string
  // Valor previsto (Agenda) quando o item veio dela.
  expectedPrice: number | null
  // Preço de catálogo, usado como valor sugerido.
  catalogPrice: number | null
  // Regra do módulo Procedimentos.
  allowPriceOverride: boolean
  // Valores atuais (quando a execução já existe).
  toothNumber: string | null
  dentition: string | null
  surfaces: string[]
  performedPrice: number | null
  notes: string | null
  professionalName: string | null
  isScheduled: boolean
}

interface ProcedureFormModalProps {
  attendanceId: string
  target: ProcedureFormTarget
  // Modo inicial do formulário.
  initialMode: "perform" | "not_performed"
  canEdit: boolean
  onClose: () => void
  onSaved: (message: string) => void
}

export function ProcedureFormModal({
  attendanceId,
  target,
  initialMode,
  canEdit,
  onClose,
  onSaved,
}: ProcedureFormModalProps) {
  const [mode, setMode] = useState<"perform" | "not_performed">(initialMode)
  const [toothNumber, setToothNumber] = useState<string | null>(target.toothNumber)
  const [dentition, setDentition] = useState<Dentition>(
    (target.dentition as Dentition) ?? "permanent"
  )
  const [surfaces, setSurfaces] = useState<string[]>(target.surfaces)
  const [priceInput, setPriceInput] = useState<string>(
    target.performedPrice !== null
      ? String(target.performedPrice)
      : target.expectedPrice !== null
        ? String(target.expectedPrice)
        : target.catalogPrice !== null
          ? String(target.catalogPrice)
          : ""
  )
  const [reasonCode, setReasonCode] = useState<string>("")
  const [reasonNote, setReasonNote] = useState("")
  const [notes, setNotes] = useState(target.notes ?? "")
  const [professionalName, setProfessionalName] = useState(
    target.professionalName ?? ""
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  // Fecha com ESC
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const suggestedPrice = useMemo(
    () => target.expectedPrice ?? target.catalogPrice ?? null,
    [target.expectedPrice, target.catalogPrice]
  )

  // Diferença explícita entre previsto e o valor digitado.
  const parsedPrice = useMemo(() => {
    if (priceInput.trim() === "") return null
    // Aceita "180", "180,00" e "180.00".
    const normalized = priceInput.replace(/\s/g, "").replace(",", ".")
    const parsed = Number(normalized)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null
  }, [priceInput])

  const priceDiffers =
    target.expectedPrice !== null &&
    parsedPrice !== null &&
    Math.abs(parsedPrice - target.expectedPrice) >= 0.01

  // Validação local (feedback imediato; o backend é a autoridade final).
  const validationMessage = useMemo(() => {
    if (!canEdit) return "O atendimento precisa estar em andamento."
    if (mode === "not_performed") {
      if (!reasonCode) return "Informe o motivo da não realização."
      return ""
    }
    if (surfaces.length > 0 && !toothNumber)
      return "Informe o dente para registrar superfícies."
    if (parsedPrice !== null && !target.allowPriceOverride && target.expectedPrice !== null) {
      if (Math.abs(parsedPrice - target.expectedPrice) >= 0.01) {
        return `O procedimento "${target.procedureName}" não permite alteração de valor.`
      }
    }
    return ""
  }, [
    canEdit,
    mode,
    reasonCode,
    surfaces,
    toothNumber,
    parsedPrice,
    target.allowPriceOverride,
    target.expectedPrice,
    target.procedureName,
  ])

  async function handleSave() {
    if (validationMessage) {
      setError(validationMessage)
      return
    }

    setIsSaving(true)
    setError("")
    try {
      const status: ProcedureExecutionStatus =
        mode === "perform" ? "performed" : "not_performed"

      const payload = {
        status,
        reasonCode: mode === "not_performed" ? reasonCode : null,
        reasonNote: mode === "not_performed" ? reasonNote || null : null,
        toothNumber: mode === "perform" ? toothNumber : target.toothNumber,
        dentition: mode === "perform" ? (toothNumber ? dentition : null) : target.dentition,
        surfaces: mode === "perform" ? surfaces : target.surfaces,
        performedPrice:
          mode === "perform" ? parsedPrice : null,
        notes: notes || null,
        professionalName: professionalName || null,
      }

      // Execução existente -> PATCH (transição de status).
      // Procedimento novo -> POST (adicionado durante o atendimento).
      const url = target.executionId
        ? `/api/attendance/${attendanceId}/procedures/${target.executionId}`
        : `/api/attendance/${attendanceId}/procedures`
      const method = target.executionId ? "PATCH" : "POST"

      const body = target.executionId
        ? payload
        : {
            ...payload,
            procedureId: target.procedureId,
            origin: "added_in_attendance" as const,
          }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        onSaved(
          mode === "perform"
            ? `${target.procedureName} registrado como realizado.`
            : `${target.procedureName} marcado como não realizado.`
        )
        return
      }

      const err = await res.json().catch(() => ({}))
      const detail = Array.isArray(err.details) && err.details[0]?.message
      setError(err.error || detail || "Não foi possível salvar o procedimento.")
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }

  const title = target.executionId
    ? mode === "perform"
      ? "Registrar como realizado"
      : "Marcar como não realizado"
    : "Adicionar procedimento"

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
        aria-labelledby="procedure-form-title"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
          <div>
            <h2
              id="procedure-form-title"
              className="text-base font-bold text-gray-900"
            >
              {title}
            </h2>
            <p className="text-xs text-gray-500">
              {target.isScheduled ? "Origem: Agenda" : "Origem: adicionado no atendimento"}
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
          {/* Procedimento (contexto) */}
          <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Procedimento
            </p>
            <p className="text-sm font-semibold text-gray-900">
              {target.procedureName}
            </p>
            {target.expectedPrice !== null && (
              <p className="mt-0.5 text-xs text-gray-500">
                Valor previsto: {formatCurrency(target.expectedPrice)}
              </p>
            )}
          </div>

          {/* Modo: realizado x não realizado */}
          {target.executionId && (
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("perform")}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition-colors",
                  mode === "perform"
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200 hover:bg-gray-50"
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Realizado
                </span>
                <span className="mt-0.5 block text-[11px] text-gray-500">
                  O procedimento foi executado.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode("not_performed")}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition-colors",
                  mode === "not_performed"
                    ? "border-gray-500 bg-gray-100"
                    : "border-gray-200 hover:bg-gray-50"
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  <AlertTriangle className="h-4 w-4 text-gray-500" />
                  Não realizado
                </span>
                <span className="mt-0.5 block text-[11px] text-gray-500">
                  Permanece no histórico com o motivo.
                </span>
              </button>
            </div>
          )}

          {mode === "perform" ? (
            <div className="space-y-5">
              <ToothSurfacePicker
                dentition={dentition}
                toothNumber={toothNumber}
                surfaces={surfaces}
                onDentitionChange={setDentition}
                onToothChange={setToothNumber}
                onSurfacesChange={setSurfaces}
                disabled={!canEdit}
              />

              {/* Valor */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">
                  Valor realizado
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">R$</span>
                  <Input
                    inputMode="decimal"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    placeholder={
                      suggestedPrice !== null ? String(suggestedPrice) : "0,00"
                    }
                    disabled={!canEdit}
                    className="w-32"
                  />
                  {!target.allowPriceOverride && (
                    <span className="text-[11px] text-gray-500">
                      Este procedimento não permite alteração de valor.
                    </span>
                  )}
                </div>

                {priceDiffers && (
                  <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800">
                    Valor diferente do previsto — Previsto:{" "}
                    {formatCurrency(target.expectedPrice)} • Realizado:{" "}
                    {formatCurrency(parsedPrice)} • Diferença:{" "}
                    {formatCurrency(
                      parsedPrice !== null && target.expectedPrice !== null
                        ? parsedPrice - target.expectedPrice
                        : null
                    )}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-gray-400">
                  O preço do catálogo não é alterado por este registro.
                </p>
              </div>

              {/* Observação */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">
                  Observação
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  disabled={!canEdit}
                  placeholder="Observação clínica sobre este procedimento..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">
                  Motivo <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {PROCEDURE_REASONS.map((reason) => (
                    <button
                      key={reason.code}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setReasonCode(reason.code)}
                      aria-pressed={reasonCode === reason.code}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        reasonCode === reason.code
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-200 text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      {reason.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">
                  Observação
                </label>
                <textarea
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  disabled={!canEdit}
                  placeholder="Ex.: Paciente optou por realizar em próxima consulta."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
                O procedimento permanece no histórico com o valor previsto, a data,
                a origem e o motivo — nada é apagado.
              </p>
            </div>
          )}

          {/* Profissional */}
          <div className="mt-5">
            <label className="mb-1.5 block text-xs font-medium text-gray-500">
              Profissional responsável
            </label>
            <Input
              value={professionalName}
              onChange={(e) => setProfessionalName(e.target.value)}
              placeholder="Nome do profissional"
              maxLength={120}
              disabled={!canEdit}
            />
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50/60 px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !canEdit || !!validationMessage}
            variant={mode === "perform" ? "default" : "outline"}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : mode === "perform" ? (
              "Confirmar realização"
            ) : (
              "Confirmar não realizado"
            )}
          </Button>
        </footer>
      </div>
    </>
  )
}

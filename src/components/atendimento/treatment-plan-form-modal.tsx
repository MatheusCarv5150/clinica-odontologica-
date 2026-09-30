"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertTriangle, Loader2, X } from "lucide-react"
import type { TreatmentPlanView } from "@/lib/schemas-treatment-plan"

// ===========================================================================
// FORMULÁRIO DE PLANO DE TRATAMENTO (Parte 10.1).
//
// Cria ou edita o cabeçalho do plano (título, objetivo, status, profissional,
// data de referência). Os ITENS são gerenciados no modal específico.
// O backend é a autoridade final sobre as regras.
// ===========================================================================

interface TreatmentPlanFormModalProps {
  attendanceId: string
  plan: TreatmentPlanView | null
  onClose: () => void
  onSaved: (message: string) => void
}

export function TreatmentPlanFormModal({
  attendanceId,
  plan,
  onClose,
  onSaved,
}: TreatmentPlanFormModalProps) {
  const isEdit = plan !== null
  const [title, setTitle] = useState(plan?.title ?? "")
  const [description, setDescription] = useState(plan?.description ?? "")
  const [notes, setNotes] = useState(plan?.notes ?? "")
  const [status, setStatus] = useState(plan?.status ?? "active")
  const [professionalName, setProfessionalName] = useState(
    plan?.professionalName ?? ""
  )
  const [plannedDate, setPlannedDate] = useState(plan?.plannedDate ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function handleSave() {
    if (title.trim().length < 2) {
      setError("Informe um título para o plano.")
      return
    }

    setIsSaving(true)
    setError("")
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        notes: notes.trim() || null,
        status,
        professionalName: professionalName.trim() || null,
        plannedDate: plannedDate || null,
      }

      const url = isEdit
        ? `/api/attendance/${attendanceId}/treatment-plans/${plan.id}`
        : `/api/attendance/${attendanceId}/treatment-plans`

      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        onSaved(
          isEdit
            ? `Plano "${title.trim()}" atualizado.`
            : `Plano "${title.trim()}" criado.`
        )
        return
      }

      const err = await res.json().catch(() => ({}))
      setError(err.error || "Não foi possível salvar o plano.")
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? "Editar plano de tratamento" : "Novo plano de tratamento"}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h4 className="text-base font-semibold text-gray-900">
            {isEdit ? "Editar plano de tratamento" : "Novo plano de tratamento"}
          </h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="plan-title">Título do plano *</Label>
            <Input
              id="plan-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Plano de Reabilitação Oral"
              maxLength={160}
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="plan-description">Descrição / objetivo</Label>
            <textarea
              id="plan-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Ex.: Tratamento restaurador e reabilitação dos elementos posteriores."
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="plan-status">Status</Label>
              <select
                id="plan-status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="draft">Rascunho</option>
                <option value="active">Em andamento</option>
                <option value="completed">Concluído</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>

            <div>
              <Label htmlFor="plan-date">Data de referência</Label>
              <Input
                id="plan-date"
                type="date"
                value={plannedDate ?? ""}
                onChange={(event) => setPlannedDate(event.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="plan-professional">Profissional responsável</Label>
            <Input
              id="plan-professional"
              value={professionalName}
              onChange={(event) => setProfessionalName(event.target.value)}
              placeholder="Nome do profissional"
              maxLength={120}
            />
          </div>

          <div>
            <Label htmlFor="plan-notes">Observações</Label>
            <textarea
              id="plan-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Observações gerais do plano (opcional)."
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3.5">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar plano"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

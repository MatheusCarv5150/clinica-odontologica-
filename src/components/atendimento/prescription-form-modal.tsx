"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertTriangle, Loader2, Pill, Plus, Trash2, X } from "lucide-react"
import {
  PRESCRIPTION_ROUTES,
  PRESCRIPTION_UNITS,
} from "@/lib/prescription-domain"

// ===========================================================================
// NOVA PRESCRIÇÃO (Parte 10.2).
//
// Interface profissional para montagem da prescrição com um ou mais itens.
// NENHUM medicamento é sugerido, inserido ou inferido automaticamente: o
// sistema apenas registra o que o profissional informar.
//
// Todos os campos do item são OPCIONAIS exceto o nome — permitindo registrar
// uma prescrição simples rapidamente.
// ===========================================================================

interface PrescriptionItemDraft {
  // Identificador local do rascunho (não persiste).
  key: string
  name: string
  activeIngredient: string
  presentation: string
  concentration: string
  quantity: string
  unit: string
  route: string
  dose: string
  frequency: string
  duration: string
  instructions: string
  observations: string
}

function emptyItem(): PrescriptionItemDraft {
  return {
    key: Math.random().toString(36).slice(2),
    name: "",
    activeIngredient: "",
    presentation: "",
    concentration: "",
    quantity: "",
    unit: "",
    route: "",
    dose: "",
    frequency: "",
    duration: "",
    instructions: "",
    observations: "",
  }
}

interface PrescriptionFormModalProps {
  attendanceId: string
  onClose: () => void
  onSaved: (message: string) => void
}

export function PrescriptionFormModal({
  attendanceId,
  onClose,
  onSaved,
}: PrescriptionFormModalProps) {
  const [items, setItems] = useState<PrescriptionItemDraft[]>([emptyItem()])
  const [guidance, setGuidance] = useState("")
  const [notes, setNotes] = useState("")
  const [professionalName, setProfessionalName] = useState("")
  const [issue, setIssue] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const filledItems = useMemo(
    () => items.filter((item) => item.name.trim().length > 0),
    [items]
  )

  function updateItem(key: string, patch: Partial<PrescriptionItemDraft>) {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item))
    )
  }

  function removeItem(key: string) {
    setItems((prev) =>
      prev.length === 1 ? prev : prev.filter((item) => item.key !== key)
    )
  }

  async function handleSave() {
    if (filledItems.length === 0) {
      setError("Adicione pelo menos um medicamento à prescrição.")
      return
    }

    setIsSaving(true)
    setError("")
    try {
      const payload = {
        items: filledItems.map((item) => ({
          name: item.name.trim(),
          activeIngredient: item.activeIngredient.trim() || null,
          presentation: item.presentation.trim() || null,
          concentration: item.concentration.trim() || null,
          quantity: parseQuantity(item.quantity),
          unit: item.unit.trim() || null,
          route: item.route.trim() || null,
          dose: item.dose.trim() || null,
          frequency: item.frequency.trim() || null,
          duration: item.duration.trim() || null,
          instructions: item.instructions.trim() || null,
          observations: item.observations.trim() || null,
        })),
        guidance: guidance.trim() || null,
        notes: notes.trim() || null,
        professionalName: professionalName.trim() || null,
        issue,
      }

      const res = await fetch(`/api/attendance/${attendanceId}/prescriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        onSaved(
          issue
            ? "Prescrição emitida e registrada no prontuário."
            : "Prescrição salva como rascunho."
        )
        return
      }

      const err = await res.json().catch(() => ({}))
      setError(err.error || "Não foi possível salvar a prescrição.")
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
      aria-label="Nova prescrição"
    >
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Pill className="h-5 w-5 text-blue-600" />
            <h4 className="text-base font-semibold text-gray-900">
              Nova prescrição
            </h4>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Itens / medicamentos */}
          <div className="space-y-3">
            {items.map((item, index) => (
              <div
                key={item.key}
                className="rounded-lg border border-gray-200 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
                    Medicamento {index + 1}
                  </p>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.key)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remover
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label>Medicamento *</Label>
                    <Input
                      value={item.name}
                      onChange={(event) =>
                        updateItem(item.key, { name: event.target.value })
                      }
                      placeholder="Ex.: Amoxicilina"
                      maxLength={200}
                    />
                  </div>

                  <div>
                    <Label>Princípio ativo</Label>
                    <Input
                      value={item.activeIngredient}
                      onChange={(event) =>
                        updateItem(item.key, {
                          activeIngredient: event.target.value,
                        })
                      }
                      maxLength={200}
                    />
                  </div>

                  <div>
                    <Label>Concentração</Label>
                    <Input
                      value={item.concentration}
                      onChange={(event) =>
                        updateItem(item.key, {
                          concentration: event.target.value,
                        })
                      }
                      placeholder="Ex.: 500 mg"
                      maxLength={80}
                    />
                  </div>

                  <div>
                    <Label>Apresentação</Label>
                    <Input
                      value={item.presentation}
                      onChange={(event) =>
                        updateItem(item.key, {
                          presentation: event.target.value,
                        })
                      }
                      placeholder="Ex.: Cápsula"
                      maxLength={80}
                    />
                  </div>

                  <div>
                    <Label>Via de administração</Label>
                    <Input
                      list={`routes-${item.key}`}
                      value={item.route}
                      onChange={(event) =>
                        updateItem(item.key, { route: event.target.value })
                      }
                      placeholder="Ex.: Oral"
                      maxLength={60}
                    />
                    <datalist id={`routes-${item.key}`}>
                      {PRESCRIPTION_ROUTES.map((route) => (
                        <option key={route} value={route} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <Label>Dose</Label>
                    <Input
                      value={item.dose}
                      onChange={(event) =>
                        updateItem(item.key, { dose: event.target.value })
                      }
                      placeholder="Ex.: 1 cápsula"
                      maxLength={120}
                    />
                  </div>

                  <div>
                    <Label>Frequência</Label>
                    <Input
                      value={item.frequency}
                      onChange={(event) =>
                        updateItem(item.key, { frequency: event.target.value })
                      }
                      placeholder="Ex.: 8 em 8 horas"
                      maxLength={120}
                    />
                  </div>

                  <div>
                    <Label>Duração</Label>
                    <Input
                      value={item.duration}
                      onChange={(event) =>
                        updateItem(item.key, { duration: event.target.value })
                      }
                      placeholder="Ex.: 7 dias"
                      maxLength={120}
                    />
                  </div>

                  <div>
                    <Label>Quantidade</Label>
                    <Input
                      inputMode="decimal"
                      value={item.quantity}
                      onChange={(event) =>
                        updateItem(item.key, { quantity: event.target.value })
                      }
                      placeholder="Ex.: 21"
                    />
                  </div>

                  <div>
                    <Label>Unidade</Label>
                    <Input
                      list={`units-${item.key}`}
                      value={item.unit}
                      onChange={(event) =>
                        updateItem(item.key, { unit: event.target.value })
                      }
                      placeholder="Ex.: cápsulas"
                      maxLength={40}
                    />
                    <datalist id={`units-${item.key}`}>
                      {PRESCRIPTION_UNITS.map((unit) => (
                        <option key={unit} value={unit} />
                      ))}
                    </datalist>
                  </div>

                  <div className="sm:col-span-2">
                    <Label>Instruções</Label>
                    <Input
                      value={item.instructions}
                      onChange={(event) =>
                        updateItem(item.key, {
                          instructions: event.target.value,
                        })
                      }
                      placeholder="Ex.: Tomar após as refeições."
                      maxLength={1000}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <Label>Observações do item</Label>
                    <Input
                      value={item.observations}
                      onChange={(event) =>
                        updateItem(item.key, {
                          observations: event.target.value,
                        })
                      }
                      maxLength={1000}
                    />
                  </div>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems((prev) => [...prev, emptyItem()])}
            >
              <Plus className="h-4 w-4" />
              Adicionar medicamento
            </Button>
          </div>

          {/* Orientações gerais */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="prescription-guidance">Orientações gerais</Label>
              <textarea
                id="prescription-guidance"
                value={guidance}
                onChange={(event) => setGuidance(event.target.value)}
                rows={2}
                maxLength={2000}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <Label htmlFor="prescription-notes">Observações</Label>
              <textarea
                id="prescription-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                maxLength={2000}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="prescription-professional">
                Profissional responsável
              </Label>
              <Input
                id="prescription-professional"
                value={professionalName}
                onChange={(event) => setProfessionalName(event.target.value)}
                placeholder="Nome do profissional"
                maxLength={120}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={issue}
                  onChange={(event) => setIssue(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Emitir agora (desmarque para salvar como rascunho)
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
            O sistema apenas registra o que o profissional informar. Nenhum
            medicamento é sugerido ou inserido automaticamente.
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
            ) : issue ? (
              "Emitir prescrição"
            ) : (
              "Salvar rascunho"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function parseQuantity(value: string): number | null {
  if (!value.trim()) return null
  const normalized = value.replace(/\s/g, "").replace(",", ".")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

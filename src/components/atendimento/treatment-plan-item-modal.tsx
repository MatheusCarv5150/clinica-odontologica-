"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertTriangle, Loader2, Search, Stethoscope, X } from "lucide-react"
import { useAsyncData } from "@/lib/use-async-data"
import type { TreatmentPlanItemView } from "@/lib/schemas-treatment-plan"
import { ToothSurfacePicker, formatCurrency } from "./procedure-ui"

// ===========================================================================
// ITEM DO PLANO DE TRATAMENTO (Parte 10.1).
//
// O item REFERENCIA o procedimento do catálogo REAL (nunca duplica cadastro) e
// usa a MESMA identificação de dente/superfície do odontograma.
//
// PLANEJADO ≠ REALIZADO: salvar aqui NÃO altera o estado clínico do dente nem
// registra execução de procedimento.
// ===========================================================================

interface ProcedureCatalogOption {
  id: string
  name: string
  code: string
  category: string
  defaultPrice: number | null
  allowPriceOverride: boolean
  active: boolean
}

interface TreatmentPlanItemModalProps {
  attendanceId: string
  planId: string
  planTitle: string
  item: TreatmentPlanItemView | null
  defaultStage: string | null
  onClose: () => void
  onSaved: (message: string) => void
}

export function TreatmentPlanItemModal({
  attendanceId,
  planId,
  planTitle,
  item,
  defaultStage,
  onClose,
  onSaved,
}: TreatmentPlanItemModalProps) {
  const isEdit = item !== null

  const [procedureId, setProcedureId] = useState<string | null>(
    item?.procedureId ?? null
  )
  const [procedureName, setProcedureName] = useState(
    item?.procedureNameSnapshot ?? ""
  )
  const [description, setDescription] = useState(item?.description ?? "")
  const [toothNumber, setToothNumber] = useState<string | null>(
    item?.toothNumber ?? null
  )
  const [dentition, setDentition] = useState<"permanent" | "deciduous">(
    (item?.dentition as "permanent" | "deciduous") ?? "permanent"
  )
  const [surfaces, setSurfaces] = useState<string[]>(item?.surfaces ?? [])
  const [priority, setPriority] = useState(item?.priority ?? "medium")
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [priceInput, setPriceInput] = useState(
    item?.expectedPrice !== null && item?.expectedPrice !== undefined
      ? String(item.expectedPrice)
      : ""
  )
  const [stage, setStage] = useState(item?.stage ?? defaultStage ?? "")
  const [stageOrder, setStageOrder] = useState(String(item?.stageOrder ?? 0))
  const [status, setStatus] = useState(item?.status ?? "planned")
  const [plannedDate, setPlannedDate] = useState(item?.plannedDate ?? "")
  const [notes, setNotes] = useState(item?.notes ?? "")

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // --- Catálogo real de procedimentos (buscado sob demanda) ---
  const loadCatalog = useCallback(async () => {
    const res = await fetch("/api/procedures", { cache: "no-store" })
    if (!res.ok) return [] as ProcedureCatalogOption[]
    const payload = await res.json()
    return (
      Array.isArray(payload) ? payload : payload?.procedures ?? []
    ) as ProcedureCatalogOption[]
  }, [])

  const { data: catalog, isLoading: isLoadingCatalog } = useAsyncData<
    ProcedureCatalogOption[]
  >(loadCatalog, [])

  const [catalogQuery, setCatalogQuery] = useState("")
  const [showPicker, setShowPicker] = useState(false)

  const filteredCatalog = useMemo(() => {
    const list = catalog ?? []
    const q = catalogQuery.trim().toLowerCase()
    const active = list.filter((p) => p.active)
    if (!q) return active.slice(0, 30)
    return active
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
      )
      .slice(0, 30)
  }, [catalog, catalogQuery])

  const parsedPrice = useMemo(() => {
    if (priceInput.trim() === "") return null
    const normalized = priceInput.replace(/\s/g, "").replace(",", ".")
    const parsed = Number(normalized)
    return Number.isFinite(parsed) && parsed >= 0
      ? Math.round(parsed * 100) / 100
      : null
  }, [priceInput])

  const parsedQuantity = useMemo(() => {
    const parsed = Number.parseInt(quantity, 10)
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
  }, [quantity])

  function selectProcedure(option: ProcedureCatalogOption) {
    setProcedureId(option.id)
    setProcedureName(option.name)
    if (priceInput.trim() === "" && option.defaultPrice !== null) {
      setPriceInput(String(option.defaultPrice))
    }
    setShowPicker(false)
  }

  function clearProcedure() {
    setProcedureId(null)
    setProcedureName("")
  }

  async function handleSave() {
    if (!procedureId && !description.trim()) {
      setError("Selecione um procedimento do catálogo ou descreva o item.")
      return
    }
    if (surfaces.length > 0 && !toothNumber) {
      setError("Informe o dente para registrar superfícies.")
      return
    }

    setIsSaving(true)
    setError("")
    try {
      const payload = {
        procedureId: procedureId ?? null,
        description: description.trim() || null,
        toothNumber: toothNumber ?? null,
        dentition: toothNumber ? dentition : null,
        surfaces,
        priority,
        expectedPrice: parsedPrice,
        quantity: parsedQuantity,
        stage: stage.trim() || null,
        stageOrder: Number.parseInt(stageOrder, 10) || 0,
        status,
        plannedDate: plannedDate || null,
        notes: notes.trim() || null,
      }

      const url = isEdit
        ? `/api/attendance/${attendanceId}/treatment-plans/${planId}/items/${item.id}`
        : `/api/attendance/${attendanceId}/treatment-plans/${planId}/items`

      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        onSaved(
          isEdit
            ? "Item do plano atualizado."
            : `Item adicionado ao plano "${planTitle}".`
        )
        return
      }

      const err = await res.json().catch(() => ({}))
      setError(err.error || "Não foi possível salvar o item.")
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
      aria-label={isEdit ? "Editar item do plano" : "Adicionar item ao plano"}
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <div>
            <h4 className="text-base font-semibold text-gray-900">
              {isEdit ? "Editar item do plano" : "Adicionar item ao plano"}
            </h4>
            <p className="text-xs text-gray-500">{planTitle}</p>
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

          {/* Procedimento do catálogo REAL */}
          <div>
            <Label>Procedimento</Label>
            {procedureId ? (
              <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-900">
                  <Stethoscope className="h-4 w-4 text-gray-400" />
                  {procedureName}
                </span>
                <button
                  type="button"
                  onClick={clearProcedure}
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => setShowPicker((v) => !v)}
                  className="flex h-9 w-full items-center gap-2 rounded-md border border-gray-200 px-3 text-sm text-gray-500 hover:bg-gray-50"
                >
                  <Search className="h-4 w-4" />
                  Buscar procedimento no catálogo
                </button>

                {showPicker && (
                  <div className="mt-2 rounded-md border border-gray-200">
                    <input
                      value={catalogQuery}
                      onChange={(event) => setCatalogQuery(event.target.value)}
                      placeholder="Digite o nome ou código..."
                      autoFocus
                      className="w-full rounded-t-md border-b border-gray-100 px-3 py-2 text-sm focus:outline-none"
                    />
                    <div className="max-h-56 overflow-y-auto">
                      {isLoadingCatalog ? (
                        <p className="flex items-center gap-2 px-3 py-3 text-xs text-gray-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Carregando catálogo...
                        </p>
                      ) : filteredCatalog.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-gray-400">
                          Nenhum procedimento ativo encontrado.
                        </p>
                      ) : (
                        <ul>
                          {filteredCatalog.map((option) => (
                            <li key={option.id}>
                              <button
                                type="button"
                                onClick={() => selectProcedure(option)}
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-blue-50"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-gray-900">
                                    {option.name}
                                  </span>
                                  <span className="block text-[11px] text-gray-500">
                                    {option.code} · {option.category}
                                  </span>
                                </span>
                                <span className="ml-3 shrink-0 text-xs text-gray-500">
                                  {formatCurrency(option.defaultPrice)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="mt-1 text-[11px] text-gray-400">
              O item referencia o catálogo existente — nenhum procedimento é
              duplicado.
            </p>
          </div>

          {/* Descrição livre */}
          <div>
            <Label htmlFor="item-description">
              Descrição do item {!procedureId && "*"}
            </Label>
            <Input
              id="item-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Ex.: Restauração em resina composta — elemento 16"
              maxLength={500}
            />
          </div>

          {/* Dente / superfície — mesma estrutura do odontograma */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3.5">
            <ToothSurfacePicker
              dentition={dentition}
              toothNumber={toothNumber}
              surfaces={surfaces}
              onDentitionChange={setDentition}
              onToothChange={setToothNumber}
              onSurfacesChange={setSurfaces}
            />
          </div>

          {/* Prioridade, quantidade e valor */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="item-priority">Prioridade</Label>
              <select
                id="item-priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>

            <div>
              <Label htmlFor="item-quantity">Quantidade</Label>
              <Input
                id="item-quantity"
                type="number"
                min={1}
                max={999}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="item-price">Valor previsto (R$)</Label>
              <Input
                id="item-price"
                inputMode="decimal"
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          {/* Etapa e data */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="item-stage">Etapa (opcional)</Label>
              <Input
                id="item-stage"
                value={stage}
                onChange={(event) => setStage(event.target.value)}
                placeholder="Ex.: Etapa 3 — Restaurações"
                maxLength={120}
              />
            </div>
            <div>
              <Label htmlFor="item-stage-order">Ordem da etapa</Label>
              <Input
                id="item-stage-order"
                type="number"
                min={0}
                max={999}
                value={stageOrder}
                onChange={(event) => setStageOrder(event.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="item-date">Data prevista</Label>
              <Input
                id="item-date"
                type="date"
                value={plannedDate ?? ""}
                onChange={(event) => setPlannedDate(event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="item-status">Status</Label>
              <select
                id="item-status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="planned">Planejado</option>
                <option value="awaiting_start">Aguardando início</option>
                <option value="in_progress">Em andamento</option>
                <option value="partially_done">Parcialmente realizado</option>
                <option value="completed">Concluído</option>
                <option value="not_done">Não realizado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="item-notes">Observações</Label>
            <textarea
              id="item-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              maxLength={1000}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
            Planejar um item <strong>não</strong> altera o estado clínico do
            dente nem registra o procedimento como realizado. A execução é
            confirmada na área <strong>Procedimentos</strong> do atendimento.
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
              "Salvar item"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Plus, Trash2, Stethoscope, Lock } from "lucide-react"
import { formatCurrency } from "@/lib/schemas"

interface Procedure {
  id: string
  name: string
  category: string
  code: string
  defaultPrice: number | null
  allowPriceOverride: boolean
  active: boolean
}

interface SelectedProcedure {
  procedureId: string
  procedureName: string
  unitPrice: number
  quantity: number
}

interface ProcedureSelectorProps {
  procedures: SelectedProcedure[]
  onChange: (procedures: SelectedProcedure[]) => void
}

export function ProcedureSelector({ procedures, onChange }: ProcedureSelectorProps) {
  const [availableProcedures, setAvailableProcedures] = useState<Procedure[]>([])
  const [selectedProcId, setSelectedProcId] = useState("")

  useEffect(() => {
    async function loadProcedures() {
      try {
        const res = await fetch("/api/procedures")
        if (res.ok) {
          const data = await res.json()
          setAvailableProcedures(data)
        }
      } catch (error) {
        console.error("Erro ao carregar procedimentos:", error)
      }
    }
    void loadProcedures()
  }, [])

  function getProcAllowOverride(procId: string): boolean {
    const proc = availableProcedures.find((p) => p.id === procId)
    return proc?.allowPriceOverride ?? true
  }

  function addProcedure() {
    if (!selectedProcId) return

    const proc = availableProcedures.find((p) => p.id === selectedProcId)
    if (!proc) return

    // Verificar se já foi adicionado
    const existingIndex = procedures.findIndex(
      (p) => p.procedureId === proc.id
    )

    if (existingIndex >= 0) {
      // Incrementar quantidade
      const updated = [...procedures]
      updated[existingIndex] = {
        ...updated[existingIndex],
        quantity: updated[existingIndex].quantity + 1,
      }
      onChange(updated)
    } else {
      onChange([
        ...procedures,
        {
          procedureId: proc.id,
          procedureName: proc.name,
          unitPrice: proc.defaultPrice || 0,
          quantity: 1,
        },
      ])
    }

    setSelectedProcId("")
  }

  function removeProcedure(index: number) {
    onChange(procedures.filter((_, i) => i !== index))
  }

 ​function updateQuantity(index: number, quantity: number) {
    const updated = [...procedures]
    updated[index] = { ...updated[index], quantity: Math.max(1, quantity) }
    onChange(updated)
  }

  function updatePrice(index: number, price: number) {
    const updated = [...procedures]
    updated[index] = { ...updated[index], unitPrice: Math.max(0, price) }
    onChange(updated)
  }

 ​const total = procedures.reduce((sum, p) => sum + p.unitPrice * p.quantity, 0)

  return (
    <div className="space-y-4">
      <Label>Procedimentos</Label>

      {/* Selecionar procedimento */}
      <div className="flex gap-2">
        <select
          className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          value={selectedProcId}
          onChange={(e) => setSelectedProcId(e.target.value)}
        >
          <option value="">Selecione um procedimento...</option>
          {availableProcedures.map((proc) => (
            <option key={proc.id} value={proc.id}>
              {proc.name} ({proc.code}) - {formatCurrency(proc.defaultPrice || 0)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={addProcedure}
          disabled={!selectedProcId}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Lista de procedimentos selecionados */}
      {procedures.length > 0 && (
        <div className="space-y-2">
          {procedures.map((proc, index) => {
            const canOverride = getProcAllowOverride(proc.procedureId)
            return (
              <Card key={index} className="border-gray-200">
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100">
                    <Stethoscope className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {proc.procedureName}
                    </p>
                    {!canOverride && (
                      <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                        <Lock className="h-3 w-3" />
                        Valor fixo (alteração não permitida)
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                        onClick={() => updateQuantity(index, proc.quantity - 1)}
                        disabled={proc.quantity <= 1}
                      >
                        -
                      </button>
                      <span className="w-8 text-center text-sm font-medium">
                        {proc.quantity}
                      </span>
                      <button
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                        onClick={() => updateQuantity(index, proc.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                    <Input
                      type="number"
                      className={`h-7 w-20 text-xs ${!canOverride ? "bg-gray-100 text-gray-500" : ""}`}
                      value={proc.unitPrice}
                      onChange={(e) => updatePrice(index, Number(e.target.value))}
                      min={0}
                      step={0.01}
                      disabled={!canOverride}
                      title={!canOverride ? "Alteração de valor não permitida para este procedimento" : ""}
                    />
                    <span className="text-sm font-medium text-gray-900 min-w-[80px] text-right">
                      {formatCurrency(proc.unitPrice * proc.quantity)}
                    </span>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded text-red-500 hover:bg-red-50"
                      onClick={() => removeProcedure(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          <div className="flex justify-end pt-2">
            <div className="text-right">
              <p className="text-sm text-gray-500">Total</p>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(total)}</p>
            </div>
          </div>
        </div>
      )}

      {procedures.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">
          Nenhum procedimento selecionado.
        </p>
      )}
    </div>
  )
}
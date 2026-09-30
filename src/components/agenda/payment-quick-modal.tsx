"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, CreditCard, X } from "lucide-react"
import { formatCurrency, PAYMENT_METHODS } from "@/lib/schemas"
import type { Appointment } from "./agenda-utils"

interface PaymentQuickModalProps {
  appointment: Appointment
  onClose: () => void
  onSuccess: () => void
}

export function PaymentQuickModal({
  appointment,
  onClose,
  onSuccess,
}: PaymentQuickModalProps) {
  const total = appointment.totalAmount || 0
  const [amount, setAmount] = useState(total.toString())
  const [paymentMethod, setPaymentMethod] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit() {
    if (!paymentMethod) {
      setError("Selecione a forma de pagamento.")
      return
    }
    const parsed = parseFloat(amount)
    if (!parsed || parsed <= 0) {
      setError("Informe um valor válido.")
      return
    }

    setIsSaving(true)
    setError("")
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId: appointment.id,
          amount: parsed,
          paymentMethod,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || "Erro ao registrar pagamento.")
        return
      }
      onSuccess()
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-16">
      <div className="relative w-full max-w-md mx-auto mb-10">
        <div className="rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <CreditCard className="h-5 w-5 text-blue-600" />
              Registrar pagamento
            </h2>
            <button
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              onClick={onClose}
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 p-5">
            <div className="rounded-lg bg-gray-50 p-3 text-sm">
              <p className="font-medium text-gray-900">{appointment.patient.fullName}</p>
              <p className="text-xs text-gray-500">
                {appointment.appointmentTime} • Valor total {formatCurrency(total)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quickAmount">Valor recebido</Label>
              <Input
                id="quickAmount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quickMethod">Forma de pagamento</Label>
              <select
                id="quickMethod"
                className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="">Selecione...</option>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" onClick={onClose} disabled={isSaving}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Confirmar pagamento"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

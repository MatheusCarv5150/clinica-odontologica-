"use client"

import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { DollarSign } from "lucide-react"
import { formatCurrency, PAYMENT_METHODS } from "@/lib/schemas"

interface PaymentFormProps {
  totalAmount: number
  payment: {
    amount: number
    paymentMethod: string
    isPaid: boolean
  }
  onChange: (payment: { amount: number; paymentMethod: string; isPaid: boolean }) => void
}

export function PaymentForm({ totalAmount, payment, onChange }: PaymentFormProps) {
  function handleChange(updates: Partial<typeof payment>) {
    onChange({ ...payment, ...updates })
  }

  function handlePaidToggle() {
    if (!payment.isPaid) {
      onChange({
        ...payment,
        amount: totalAmount,
        isPaid: true,
      })
    } else {
      onChange({
        ...payment,
        isPaid: false,
      })
    }
  }

  return (
    <div className="space-y-4">
      <Label>Pagamento</Label>

      <Card className={payment.isPaid ? "border-green-200 bg-green-50" : "border-gray-200"}>
        <CardContent className="p-4 space-y-4">
          {/* Resumo do valor */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Valor total</span>
            <span className="text-lg font-bold text-gray-900">
              {formatCurrency(totalAmount)}
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentMethod">Forma de pagamento</Label>
            <select
              id="paymentMethod"
              className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={payment.paymentMethod}
              onChange={(e) => handleChange({ paymentMethod: e.target.value })}
            >
              <option value="">Selecione...</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status do pagamento */}
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-gray-700">Pago no ato</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={payment.isPaid}
              onClick={handlePaidToggle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                payment.isPaid ? "bg-green-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  payment.isPaid ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Loader2, AlertTriangle, X, CheckCircle, Ban, CreditCard } from "lucide-react"
import type { Appointment } from "./agenda-utils"

interface EditAppointmentModalProps {
  appointment: Appointment
  onClose: () => void
  onSuccess: () => void
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

const STATUS_OPTIONS = [
  { value: "scheduled", label: "Agendado", color: "bg-blue-100 text-blue-700" },
  { value: "awaiting_payment", label: "Aguardando pagamento", color: "bg-yellow-100 text-yellow-700" },
  { value: "paid", label: "Pago", color: "bg-green-100 text-green-700" },
  { value: "awaiting_attendance", label: "Aguardando atendimento", color: "bg-purple-100 text-purple-700" },
  { value: "in_progress", label: "Em andamento", color: "bg-indigo-100 text-indigo-700" },
  { value: "completed", label: "Concluído", color: "bg-green-100 text-green-700" },
  { value: "cancelled", label: "Cancelado", color: "bg-red-100 text-red-700" },
  { value: "no_show", label: "Não compareceu", color: "bg-gray-100 text-gray-700" },
]

const PAYMENT_METHODS = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "PIX" },
  { value: "cartao_debito", label: "Cartão de Débito" },
  { value: "cartao_credito", label: "Cartão de Crédito" },
  { value: "transferencia", label: "Transferência" },
  { value: "outros", label: "Outros" },
]

export function EditAppointmentModal({ appointment, onClose, onSuccess }: EditAppointmentModalProps) {
  const [status, setStatus] = useState(appointment.status)
  const [date, setDate] = useState(
    appointment.appointmentDate
      ? new Date(appointment.appointmentDate).toISOString().split("T")[0]
      : ""
  )
  const [time, setTime] = useState(appointment.appointmentTime || "")
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState("")
  const [successMessage, setSuccessMessage] = useState("")
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState("")
  const [paymentAmount, setPaymentAmount] = useState(appointment.totalAmount?.toString() || "0")

  const hasPendingPayment = appointment.status === "awaiting_payment" || appointment.status === "scheduled"
  const hasHealthNotes = appointment.patient.healthNotes && appointment.patient.healthNotes.trim().length > 0

  async function handleSave() {
    setIsSaving(true)
    setError("")
    setSuccessMessage("")

    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          ...(date && { appointmentDate: date }),
          ...(time && { appointmentTime: time }),
        }),
      })

      if (res.ok) {
        setSuccessMessage("Agendamento atualizado com sucesso!")
        setTimeout(() => {
          onSuccess()
        }, 800)
      } else {
        const err = await res.json()
        setError(err.error || "Erro ao atualizar agendamento")
      }
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm("Tem certeza que deseja excluir este agendamento? Esta ação não pode ser desfeita.")) {
      return
    }

    setIsDeleting(true)
    setError("")

    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, {
        method: "DELETE",
      })

      if (res.ok) {
        setSuccessMessage("Agendamento excluído com sucesso!")
        setTimeout(() => {
          onSuccess()
        }, 800)
      } else {
        const err = await res.json()
        setError(err.error || "Erro ao excluir agendamento")
      }
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleProcessPayment() {
    if (!paymentMethod) {
      setError("Selecione a forma de pagamento.")
      return
    }

    setIsSaving(true)
    setError("")
    setSuccessMessage("")

    try {
      // Criar pagamento (a API já atualiza o status do agendamento para "paid")
      const paymentRes = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId: appointment.id,
          amount: parseFloat(paymentAmount) || appointment.totalAmount || 0,
          paymentMethod,
        }),
      })

      if (!paymentRes.ok) {
        const err = await paymentRes.json()
        setError(err.error || "Erro ao processar pagamento")
        setIsSaving(false)
        return
      }

      setSuccessMessage("Pagamento registrado com sucesso!")
      setShowPaymentForm(false)
      setStatus("paid")
      setTimeout(() => {
        onSuccess()
      }, 800)
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }

  const hasPayment = appointment.payments && appointment.payments.length > 0
  const lastPayment = hasPayment ? appointment.payments[appointment.payments.length - 1] : null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-10">
      <div className="relative w-full max-w-lg mx-auto mb-10">
        <div className="rounded-xl bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Gerenciar Agendamento</h2>
            <button
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            {/* Alerta de saúde do paciente */}
            {hasHealthNotes && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">
                      Atenção: Paciente possui observações importantes
                    </p>
                    <p className="mt-1 text-xs text-amber-700">
                      {appointment.patient.healthNotes}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Dados do paciente */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Paciente</p>
              <p className="mt-1 text-base font-medium text-gray-900">{appointment.patient.fullName}</p>
            </div>

            {/* Procedimentos */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Procedimentos</p>
              <div className="mt-2 space-y-1">
                {appointment.procedures.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-900">{p.procedureNameSnapshot}</span>
                    <span className="text-gray-500">
                      {formatCurrency(p.totalPrice)}
                    </span>
                  </div>
                ))}
                {appointment.totalAmount != null && appointment.totalAmount > 0 && (
                  <div className="flex items-center justify-between border-t border-gray-100 pt-1 text-sm font-medium">
                    <span className="text-gray-700">Total</span>
                    <span className="text-gray-900">{formatCurrency(appointment.totalAmount)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Status atual */}
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Status atual</p>
              <div className="mt-2">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Data e horário */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-date">Data</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-time">Horário</Label>
                <Input
                  id="edit-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>

            {/* Informações de pagamento */}
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Pagamento</p>
                {hasPayment && lastPayment?.status === "paid" ? (
                  <Badge className="bg-green-100 text-green-700 border-green-200">
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Pago
                  </Badge>
                ) : hasPendingPayment ? (
                  <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">
                    Pendente
                  </Badge>
                ) : (
                  <Badge className="bg-gray-100 text-gray-700 border-gray-200">
                    {lastPayment?.status === "refunded" ? "Estornado" : "N/A"}
                  </Badge>
                )}
              </div>

              {lastPayment && (
                <div className="mt-2 text-sm text-gray-500">
                  <p>Forma: {PAYMENT_METHODS.find((m) => m.value === lastPayment.paymentMethod)?.label || lastPayment.paymentMethod}</p>
                  <p>Valor: {formatCurrency(lastPayment.amount)}</p>
                </div>
              )}

              {hasPendingPayment && !hasPayment && (
                <div className="mt-3">
                  {!showPaymentForm ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowPaymentForm(true)}
                    >
                      <CreditCard className="mr-2 h-4 w-4" />
                      Lançar pagamento
                    </Button>
                  ) : (
                    <div className="space-y-3 pt-2 border-t border-gray-100">
                      <p className="text-sm font-medium text-gray-700">Registrar pagamento</p>
                      <div>
                        <Label htmlFor="payment-amount">Valor</Label>
                        <Input
                          id="payment-amount"
                          type="number"
                          step="0.01"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="payment-method">Forma de pagamento</Label>
                        <select
                          id="payment-method"
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Selecione...</option>
                          {PAYMENT_METHODS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => setShowPaymentForm(false)}
                        >
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={handleProcessPayment}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle className="mr-1 h-4 w-4" />
                          )}
                          Confirmar pagamento
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mensagens */}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {successMessage && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                {successMessage}
              </div>
            )}

            {/* Ações */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
              <Button
                variant="outline"
                className="bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                onClick={handleDelete}
                disabled={isDeleting || isSaving}
              >
                {isDeleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Ban className="mr-2 h-4 w-4" />
                )}
                Excluir
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Fechar
                </Button>
                <Button onClick={handleSave} disabled={isSaving || isDeleting}>
                  {isSaving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-2 h-4 w-4" />
                  )}
                  Salvar
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
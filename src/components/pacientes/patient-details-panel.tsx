"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { X, AlertTriangle, Calendar, ClipboardList, Loader2 } from "lucide-react"
import { formatCurrency } from "@/lib/schemas"

interface PatientDetails {
  id: string
  fullName: string
  cpf: string
  birthDate: string
  healthNotes: string | null
  appointments: Array<{
    id: string
    appointmentDate: string
    appointmentTime: string
    status: string
    totalAmount: number | null
    procedures: Array<{
      id: string
      procedureNameSnapshot: string
      unitPrice: number
      quantity: number
      totalPrice: number
      procedure: { name: string }
    }>
    payments: Array<{
      id: string
      amount: number
      paymentMethod: string
      status: string
    }>
  }>
}

interface PatientDetailsPanelProps {
  patientId: string
  onClose: () => void
  onEdit: (patient: {
    id?: string
    fullName?: string
    cpf?: string
    phone?: string | null
    birthDate?: string
    healthNotes?: string | null
  }) => void
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString("pt-BR")
}

function formatCPF(cpf: string): string {
  const cleaned = cpf.replace(/\D/g, "")
  if (cleaned.length !== 11) return cpf
  return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9)}`
}

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    scheduled: "Agendado",
    awaiting_payment: "Aguardando pagamento",
    paid: "Pago",
    awaiting_attendance: "Aguardando atendimento",
    in_progress: "Em andamento",
    completed: "Concluído",
    cancelled: "Cancelado",
    no_show: "Não compareceu",
  }
  return map[status] || status
}

function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-700 border-blue-200",
    awaiting_payment: "bg-yellow-100 text-yellow-700 border-yellow-200",
    paid: "bg-green-100 text-green-700 border-green-200",
    awaiting_attendance: "bg-purple-100 text-purple-700 border-purple-200",
    in_progress: "bg-indigo-100 text-indigo-700 border-indigo-200",
    completed: "bg-green-100 text-green-700 border-green-200",
    cancelled: "bg-red-100 text-red-700 border-red-200",
    no_show: "bg-gray-100 text-gray-700 border-gray-200",
  }
  return map[status] || "bg-gray-100 text-gray-700 border-gray-200"
}

export function PatientDetailsPanel({ patientId, onClose, onEdit }: PatientDetailsPanelProps) {
  const [details, setDetails] = useState<PatientDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    async function loadDetails() {
      setIsLoading(true)
      setError("")
      try {
        const res = await fetch(`/api/patients/${patientId}`)
        if (res.ok) {
          const data = await res.json()
          setDetails(data)
        } else {
          setError("Erro ao carregar dados do paciente")
        }
      } catch {
        setError("Erro de conexão")
      } finally {
        setIsLoading(false)
      }
    }
    loadDetails()
  }, [patientId])

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="rounded-xl bg-white p-8 shadow-2xl">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </div>
    )
  }

  if (error || !details) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="rounded-xl bg-white p-8 shadow-2xl">
          <p className="text-red-600">{error || "Paciente não encontrado"}</p>
          <Button variant="outline" className="mt-4" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    )
  }

  const hasHealthNotes = details.healthNotes && details.healthNotes.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div className="w-full max-w-2xl overflow-y-auto bg-white shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Detalhes do Paciente</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(details)}
            >
              Editar paciente
            </Button>
            <button
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Alerta de saúde */}
          {hasHealthNotes && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium text-amber-800">
                    Atenção: existem observações importantes cadastradas para este paciente.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Dados do paciente */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados do paciente</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Nome completo</dt>
                  <dd className="mt-1 text-sm text-gray-900">{details.fullName}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">CPF</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatCPF(details.cpf)}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Data de nascimento</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDate(details.birthDate)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Observações */}
          {hasHealthNotes && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Observações
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-gray-700">
                  {details.healthNotes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Histórico */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4 text-blue-500" />
                Últimos agendamentos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {details.appointments.length === 0 ? (
                <p className="text-sm text-gray-500">
                  Nenhum agendamento encontrado para este paciente.
                </p>
              ) : (
                <div className="space-y-4">
                  {details.appointments.map((appt) => (
                    <div
                      key={appt.id}
                      className="rounded-lg border border-gray-200 p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {formatDate(appt.appointmentDate)} — {appt.appointmentTime}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {appt.procedures.map((p) => (
                              <Badge key={p.id} variant="default" className="text-xs">
                                {p.procedureNameSnapshot}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <Badge className={`${getStatusColor(appt.status)} text-xs`}>
                          {getStatusLabel(appt.status)}
                        </Badge>
                      </div>
                      {appt.totalAmount != null && appt.totalAmount > 0 && (
                        <p className="mt-2 text-xs text-gray-500">
                          Valor: {formatCurrency(appt.totalAmount)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Procedimentos anteriores */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4 text-blue-500" />
                Procedimentos anteriores
              </CardTitle>
            </CardHeader>
            <CardContent>
              {details.appointments.filter((a) => a.status === "completed" || a.status === "paid").length === 0 ? (
                <p className="text-sm text-gray-500">
                  Nenhum procedimento realizado anteriormente.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Data</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Procedimento</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-500">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.appointments
                        .filter((a) => a.status === "completed" || a.status === "paid")
                        .map((appt) =>
                          appt.procedures.map((p) => (
                            <tr key={p.id} className="border-b border-gray-100">
                              <td className="px-3 py-2 text-gray-900">
                                {formatDate(appt.appointmentDate)}
                              </td>
                              <td className="px-3 py-2 text-gray-900">
                                {p.procedureNameSnapshot}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-900">
                                {formatCurrency(p.totalPrice)}
                              </td>
                            </tr>
                          ))
                        )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
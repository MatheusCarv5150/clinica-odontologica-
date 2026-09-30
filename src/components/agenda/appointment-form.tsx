"use client"

import { useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { appointmentSchema, type AppointmentInput } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { PatientSearch } from "./patient-search"
import { PatientForm } from "./patient-form"
import { ProcedureSelector } from "./procedure-selector"
import { PaymentForm } from "./payment-form"
import { CalendarCheck, Loader2, ArrowLeft, CheckCircle } from "lucide-react"

interface AppointmentFormProps {
  onSuccess: () => void
  selectedDate?: string
}

export function AppointmentForm({ onSuccess, selectedDate }: AppointmentFormProps) {
  const [step, setStep] = useState<"patient" | "procedures" | "payment">("patient")
  const [selectedPatient, setSelectedPatient] = useState<{
    id: string
    fullName: string
    cpf: string
    birthDate: string
  } | null>(null)
  const [showPatientForm, setShowPatientForm] = useState(false)
  const [newPatientInitialName, setNewPatientInitialName] = useState("")
  const [procedures, setProcedures] = useState<AppointmentInput["procedures"]>([])
  const [payment, setPayment] = useState({ amount: 0, paymentMethod: "", isPaid: false })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  const {
    register,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<z.output<typeof appointmentSchema>>({
    resolver: zodResolver(appointmentSchema) as Resolver<z.output<typeof appointmentSchema>>,
    mode: "onTouched",
    defaultValues: {
      patientId: "",
      appointmentDate: selectedDate || new Date().toISOString().split("T")[0],
      appointmentTime: "09:00",
      procedures: [],
      payment: { amount: 0, paymentMethod: "", isPaid: false },
    },
  })

  function handleSelectPatient(patient: { id: string; fullName: string; cpf: string; birthDate: string }) {
    setSelectedPatient(patient)
    setShowPatientForm(false)
  }

  function handleNewPatientSuccess(patient: { id: string; fullName: string; cpf: string; birthDate: string }) {
    setSelectedPatient(patient)
    setShowPatientForm(false)
  }

  async function handleNextToProcedures() {
    const valid = await trigger(["appointmentDate", "appointmentTime"])
    if (valid) setStep("procedures")
  }

  async function handleSubmitAppointment() {
    if (!selectedPatient) return

    setIsSubmitting(true)
    setError("")

    try {
      const { appointmentDate, appointmentTime } = getValues()
      const payload = {
        patientId: selectedPatient.id,
        appointmentDate,
        appointmentTime,
        procedures,
        payment,
      }

      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        setSuccess(true)
        setTimeout(() => {
          onSuccess()
        }, 1500)
      } else {
        const result = await res.json().catch(() => null)
        setError(result?.error || "Erro ao criar agendamento")
        setIsSubmitting(false)
      }
    } catch {
      setError("Erro de conexão. Tente novamente.")
      setIsSubmitting(false)
    }
  }

  const totalAmount = procedures.reduce((sum, p) => sum + p.unitPrice * p.quantity, 0)

  if (success) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Agendamento criado!</h3>
          <p className="text-sm text-gray-500 text-center">
            O agendamento foi registrado com sucesso.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (showPatientForm) {
    return (
      <div>
        <button
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mb-4"
          onClick={() => setShowPatientForm(false)}
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <PatientForm
          initialName={newPatientInitialName}
          onSuccess={handleNewPatientSuccess}
          onCancel={() => setShowPatientForm(false)}
        />
      </div>
    )
  }

  return (
    <div>
      <div className="space-y-6">
        {/* Cabeçalho do formulário */}
        <div className="flex items-center gap-2 mb-6">
          <CalendarCheck className="h-6 w-6 text-blue-600" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Novo Agendamento</h2>
            <p className="text-sm text-gray-500">Preencha os dados para criar um novo agendamento</p>
          </div>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 mb-6">
          {["patient", "procedures", "payment"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                step === s
                  ? "bg-blue-600 text-white"
                  : ["procedures", "payment", "confirmation"].indexOf(step) >= ["patient", "procedures", "payment"].indexOf(s)
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-400"
              }`}>
                {i + 1}
              </div>
              <span className="text-sm text-gray-500">{["Paciente", "Procedimentos", "Pagamento"][i]}</span>
              {i < 2 && <div className="h-px w-8 bg-gray-200" />}
            </div>
          ))}
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 mb-4">
            {error}
          </div>
        )}

        {/* Step 1: Paciente */}
        {step === "patient" && (
          <div className="space-y-4">
            <PatientSearch
              onSelectPatient={handleSelectPatient}
              onNewPatient={(name) => {
                setNewPatientInitialName(name || "")
                setShowPatientForm(true)
              }}
              selectedPatient={selectedPatient}
            />
            {selectedPatient && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="appointmentDate">Data do agendamento</Label>
                  <Input
                    id="appointmentDate"
                    type="date"
                    {...register("appointmentDate")}
                  />
                  {errors.appointmentDate && (
                    <p className="text-xs text-red-500">{errors.appointmentDate.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="appointmentTime">Horário</Label>
                  <Input
                    id="appointmentTime"
                    type="time"
                    {...register("appointmentTime")}
                  />
                  {errors.appointmentTime && (
                    <p className="text-xs text-red-500">{errors.appointmentTime.message}</p>
                  )}
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={!selectedPatient}
                onClick={handleNextToProcedures}
              >
                Próximo
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Procedimentos */}
        {step === "procedures" && (
          <div className="space-y-4">
            <ProcedureSelector
              procedures={procedures}
              onChange={setProcedures}
            />
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep("patient")}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Voltar
              </Button>
              <Button
                type="button"
                disabled={procedures.length === 0}
                onClick={() => setStep("payment")}
              >
                Próximo
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Pagamento */}
        {step === "payment" && (
          <div className="space-y-4">
            <PaymentForm
              totalAmount={totalAmount}
              payment={payment}
              onChange={setPayment}
            />
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep("procedures")}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Voltar
              </Button>
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={handleSubmitAppointment}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  "Confirmar Agendamento"
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
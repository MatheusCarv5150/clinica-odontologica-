"use client"

import { useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { patientSchema, formatCPF, type PatientInput } from "@/lib/schemas"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2, UserPlus, X } from "lucide-react"

interface PatientFormModalProps {
  onSuccess: (patient: { id: string; fullName: string; cpf: string; birthDate: string; phone?: string | null }) => void
  onCancel: () => void
  initialData?: {
    id?: string
    fullName?: string
    cpf?: string
    phone?: string | null
    birthDate?: string
    healthNotes?: string | null
  }
}

export function PatientFormModal({ onSuccess, onCancel, initialData }: PatientFormModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const isEditing = !!initialData?.id

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<z.output<typeof patientSchema>>({
    resolver: zodResolver(patientSchema) as Resolver<z.output<typeof patientSchema>>,
    defaultValues: {
      fullName: initialData?.fullName || "",
      cpf: initialData?.cpf ? formatCPF(initialData.cpf) : "",
      phone: initialData?.phone || "",
      birthDate: initialData?.birthDate
        ? new Date(initialData.birthDate).toISOString().split("T")[0]
        : "",
      healthNotes: initialData?.healthNotes || "",
    },
  })

  async function onSubmit(data: PatientInput) {
    setIsSubmitting(true)
    setError("")

    try {
      if (isEditing && initialData?.id) {
        // Editar paciente existente
        const res = await fetch(`/api/patients/${initialData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        })

        if (res.ok) {
          const result = await res.json()
          onSuccess(result)
        } else {
          const err = await res.json()
          setError(err.error || "Erro ao atualizar paciente")
        }
      } else {
        // Criar novo paciente
        const res = await fetch("/api/patients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        })

        const result = await res.json()

        if (res.ok) {
          onSuccess(result)
        } else if (res.status === 409) {
          setError("CPF já cadastrado no sistema.")
        } else {
          setError(result.error || "Erro ao cadastrar paciente")
        }
      }
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleCPFChange(value: string) {
    const formatted = formatCPF(value)
    setValue("cpf", formatted, { shouldValidate: true })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-10">
      <div className="relative w-full max-w-lg mx-auto mb-10">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-blue-600" />
                <CardTitle>{isEditing ? "Editar Paciente" : "Novo Paciente"}</CardTitle>
              </div>
              <button
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                onClick={onCancel}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <CardDescription>
              {isEditing
                ? "Altere os dados do paciente"
                : "Cadastre um novo paciente no sistema"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Nome completo *</Label>
                <Input
                  id="fullName"
                  placeholder="Nome do paciente"
                  {...register("fullName")}
                />
                {errors.fullName && (
                  <p className="text-sm text-red-500">{errors.fullName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cpf">CPF *</Label>
                <Input
                  id="cpf"
                  placeholder="000.000.000-00"
                  maxLength={14}
                  {...register("cpf", {
                    onChange: (e) => handleCPFChange(e.target.value),
                  })}
                />
                {errors.cpf && (
                  <p className="text-sm text-red-500">{errors.cpf.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Telefone / WhatsApp</Label>
                <Input
                  id="phone"
                  placeholder="(11) 99999-9999"
                  {...register("phone")}
                />
                {errors.phone && (
                  <p className="text-sm text-red-500">{errors.phone.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="birthDate">Data de nascimento *</Label>
                <Input
                  id="birthDate"
                  type="date"
                  {...register("birthDate")}
                />
                {errors.birthDate && (
                  <p className="text-sm text-red-500">{errors.birthDate.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="healthNotes">Observações / Condições de saúde</Label>
                <textarea
                  id="healthNotes"
                  className="flex min-h-[80px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Alergias, condições pré-existentes, observações importantes..."
                  {...register("healthNotes")}
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={onCancel}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Salvando...
                    </>
                  ) : isEditing ? (
                    "Salvar alterações"
                  ) : (
                    "Cadastrar paciente"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
"use client"

import { useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { patientSchema, type PatientInput, formatCPF } from "@/lib/schemas"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2, UserPlus } from "lucide-react"

interface PatientFormProps {
  onSuccess: (patient: { id: string; fullName: string; cpf: string; birthDate: string; phone?: string | null }) => void
  onCancel: () => void
  initialName?: string
}

export function PatientForm({ onSuccess, onCancel, initialName }: PatientFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<z.output<typeof patientSchema>>({
    resolver: zodResolver(patientSchema) as Resolver<z.output<typeof patientSchema>>,
    defaultValues: {
      fullName: initialName || "",
      cpf: "",
      phone: "",
      birthDate: "",
      healthNotes: "",
    },
  })

  async function onSubmit(data: PatientInput) {
    setIsSubmitting(true)
    setError("")

    try {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      const result = await res.json()

      if (res.ok) {
        onSuccess(result)
      } else if (res.status === 409) {
        // Paciente já existe - pergunta se quer selecionar
        if (confirm("Este paciente já está cadastrado. Deseja selecioná-lo?")) {
          onSuccess(result.patient)
        }
      } else {
        setError(result.error || "Erro ao cadastrar paciente")
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-blue-600" />
          Novo Paciente
        </CardTitle>
        <CardDescription>
          Cadastre um novo paciente no sistema
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="fullName">Nome completo</Label>
            <Input
              id="fullName"
              placeholder="Nome do paciente"
              {...register("fullName")}
            />
            {errors.fullName && (
              <p className="text-xs text-red-500">{errors.fullName.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cpf">CPF</Label>
              <Input
                id="cpf"
                placeholder="000.000.000-00"
                maxLength={14}
                {...register("cpf", {
                  onChange: (e) => handleCPFChange(e.target.value),
                })}
              />
              {errors.cpf && (
                <p className="text-xs text-red-500">{errors.cpf.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Telefone / WhatsApp (opcional)</Label>
              <Input
                id="phone"
                placeholder="(11) 99999-9999"
                {...register("phone")}
              />
              {errors.phone && (
                <p className="text-xs text-red-500">{errors.phone.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="birthDate">Data de nascimento</Label>
            <Input
              id="birthDate"
              type="date"
              {...register("birthDate")}
            />
            {errors.birthDate && (
              <p className="text-xs text-red-500">{errors.birthDate.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="healthNotes">Observações de saúde (opcional)</Label>
            <textarea
              id="healthNotes"
              className="flex min-h-[80px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Alergias, condições, medicamentos..."
              {...register("healthNotes")}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar Paciente"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
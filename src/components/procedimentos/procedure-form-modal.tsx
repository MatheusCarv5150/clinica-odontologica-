"use client"

import { useState } from "react"
import { useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { procedureSchema, PROCEDURE_CATEGORIES } from "@/lib/schemas"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2, Syringe, X } from "lucide-react"

interface ProcedureFormModalProps {
  onSuccess: () => void
  onCancel: () => void
  initialData?: {
    id?: string
    name?: string
    category?: string
    code?: string
    defaultPrice?: number | null
    allowPriceOverride?: boolean
    description?: string | null
    active?: boolean
  }
}

export function ProcedureFormModal({ onSuccess, onCancel, initialData }: ProcedureFormModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const isEditing = !!initialData?.id

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<z.output<typeof procedureSchema>>({
    resolver: zodResolver(procedureSchema) as Resolver<z.output<typeof procedureSchema>>,
    defaultValues: {
      name: initialData?.name || "",
      category: initialData?.category || "Outros",
      code: initialData?.code || "",
      defaultPrice: initialData?.defaultPrice ?? 0,
      allowPriceOverride: initialData?.allowPriceOverride ?? true,
      description: initialData?.description || "",
      active: initialData?.active ?? true,
    },
  })

  const allowPriceOverride = useWatch({ control, name: "allowPriceOverride" })
  const isActive = useWatch({ control, name: "active" })

  async function onSubmit(data: z.output<typeof procedureSchema>) {
    setIsSubmitting(true)
    setError("")

    try {
      if (isEditing && initialData?.id) {
        // Editar procedimento existente
        const res = await fetch(`/api/procedures/${initialData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        })

        if (res.ok) {
          onSuccess()
        } else {
          const err = await res.json()
          setError(err.error || "Erro ao atualizar procedimento")
        }
      } else {
        // Criar novo procedimento
        const res = await fetch("/api/procedures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        })

        if (res.ok) {
          onSuccess()
        } else if (res.status === 409) {
          const err = await res.json()
          setError(err.error || "Procedimento já cadastrado.")
        } else {
          const err = await res.json()
          setError(err.error || "Erro ao cadastrar procedimento")
        }
      }
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-10">
      <div className="relative w-full max-w-lg mx-auto mb-10">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Syringe className="h-5 w-5 text-blue-600" />
                <CardTitle>{isEditing ? "Editar Procedimento" : "Novo Procedimento"}</CardTitle>
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
                ? "Altere os dados do procedimento"
                : "Cadastre um novo procedimento no sistema"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Nome */}
              <div className="space-y-2">
                <Label htmlFor="name">Nome do procedimento *</Label>
                <Input
                  id="name"
                  placeholder="Ex: Restauração em resina"
                  {...register("name")}
                />
                {errors.name && (
                  <p className="text-sm text-red-500">{errors.name.message}</p>
                )}
              </div>

              {/* Categoria */}
              <div className="space-y-2">
                <Label htmlFor="category">Categoria *</Label>
                <select
                  id="category"
                  className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  {...register("category")}
                >
                  {PROCEDURE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                {errors.category && (
                  <p className="text-sm text-red-500">{errors.category.message}</p>
                )}
              </div>

              {/* Código */}
              <div className="space-y-2">
                <Label htmlFor="code">Código interno *</Label>
                <Input
                  id="code"
                  placeholder="Ex: REST-001"
                  {...register("code")}
                />
                {errors.code && (
                  <p className="text-sm text-red-500">{errors.code.message}</p>
                )}
              </div>

              {/* Valor padrão */}
              <div className="space-y-2">
                <Label htmlFor="defaultPrice">Valor padrão (R$) *</Label>
                <Input
                  id="defaultPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  {...register("defaultPrice", { valueAsNumber: true })}
                />
                {errors.defaultPrice && (
                  <p className="text-sm text-red-500">{errors.defaultPrice.message}</p>
                )}
              </div>

              {/* Permitir alteração na Agenda */}
              <div className="space-y-2">
                <Label>Permitir alteração de valor na Agenda</Label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                      checked={allowPriceOverride === true}
                      onChange={() => setValue("allowPriceOverride", true, { shouldDirty: true, shouldValidate: true })}
                    />
                    <span className="text-sm text-gray-700">Sim</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                      checked={allowPriceOverride === false}
                      onChange={() => setValue("allowPriceOverride", false, { shouldDirty: true, shouldValidate: true })}
                    />
                    <span className="text-sm text-gray-700">Não</span>
                  </label>
                </div>
                <p className="text-xs text-gray-500">
                  {allowPriceOverride
                    ? "O valor poderá ser alterado no momento do agendamento."
                    : "A Agenda usará o valor padrão e não permitirá alteração."}
                </p>
              </div>

              {/* Descrição */}
              <div className="space-y-2">
                <Label htmlFor="description">Descrição / Observações</Label>
                <textarea
                  id="description"
                  className="flex min-h-[80px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Informações internas sobre o procedimento..."
                  {...register("description")}
                />
              </div>

              {/* Status (só na edição) */}
              {isEditing && (
                <div className="space-y-2">
                  <Label>Status</Label>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                        checked={isActive === true}
                        onChange={() => setValue("active", true, { shouldDirty: true, shouldValidate: true })}
                      />
                      <span className="text-sm text-gray-700">Ativo</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                        checked={isActive === false}
                        onChange={() => setValue("active", false, { shouldDirty: true, shouldValidate: true })}
                      />
                      <span className="text-sm text-gray-700">Inativo</span>
                    </label>
                  </div>
                </div>
              )}

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
                    "Salvar procedimento"
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
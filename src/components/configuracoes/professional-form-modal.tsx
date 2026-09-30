"use client"

// ===========================================================================
// MODAL DE CADASTRO/EDIÇÃO DE USUÁRIO/PROFISSIONAL — módulo Configurações.
// ===========================================================================
//
// Formulário de identidade profissional. A validação aqui é apenas para UX:
// o BACKEND revalida tudo (é a autoridade). CPF é normalizado e validado com
// dígitos verificadores; a data de nascimento não pode ser futura.
//
// IMPORTANTE: este cadastro NÃO possui login/senha/sessão. A autenticação é
// uma etapa futura; aqui criamos apenas a identidade persistente do
// profissional, referenciada pelo Atendimento.

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Loader2, UserPlus, X } from "lucide-react"
import { validateCPF, COUNCIL_TYPES, BRAZILIAN_STATES } from "@/lib/professionals-domain"

export interface ProfessionalEditable {
  id?: string
  fullName?: string
  birthDate?: string
  cpf?: string
  councilType?: string
  councilNumber?: string
  councilState?: string | null
  status?: "active" | "inactive"
}

interface ProfessionalFormModalProps {
  onSuccess: () => void
  onCancel: () => void
  initialData?: ProfessionalEditable
}

type FormState = {
  fullName: string
  birthDate: string
  cpf: string
  councilType: string
  councilNumber: string
  councilState: string
  status: "active" | "inactive"
}

function formatCpfInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`
}

export function ProfessionalFormModal({
  onSuccess,
  onCancel,
  initialData,
}: ProfessionalFormModalProps) {
  const isEditing = !!initialData?.id

  const [form, setForm] = useState<FormState>({
    fullName: initialData?.fullName ?? "",
    birthDate: initialData?.birthDate
      ? new Date(initialData.birthDate).toISOString().split("T")[0]
      : "",
    cpf: initialData?.cpf ? formatCpfInput(initialData.cpf) : "",
    councilType: initialData?.councilType ?? "CRO",
    councilNumber: initialData?.councilNumber ?? "",
    councilState: initialData?.councilState ?? "",
    status: initialData?.status ?? "active",
  })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  // Validação de UX (espelha a do backend, sem substituí-la).
  function validate(): boolean {
    const errors: Record<string, string> = {}

    const fullName = form.fullName.trim().replace(/\s+/g, " ")
    if (!fullName) errors.fullName = "O nome completo é obrigatório."
    else if (fullName.length < 3)
      errors.fullName = "Nome completo deve ter pelo menos 3 caracteres."

    if (!form.birthDate) {
      errors.birthDate = "A data de nascimento é obrigatória."
    } else {
      const birth = new Date(form.birthDate)
      if (isNaN(birth.getTime())) errors.birthDate = "Data de nascimento inválida."
      else if (birth > new Date())
        errors.birthDate = "A data de nascimento não pode ser futura."
    }

    const cpfDigits = form.cpf.replace(/\D/g, "")
    if (!cpfDigits) errors.cpf = "O CPF é obrigatório."
    else if (!validateCPF(cpfDigits)) errors.cpf = "CPF inválido."

    if (!form.councilType) errors.councilType = "Selecione o conselho profissional."
    if (!form.councilNumber.trim())
      errors.councilNumber = "O número do conselho é obrigatório."

    const uf = form.councilState.trim().toUpperCase()
    if (uf && !/^[A-Z]{2}$/.test(uf)) errors.councilState = "UF inválida."

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError("")

    if (!validate()) return

    setIsSubmitting(true)
    try {
      const payload = {
        fullName: form.fullName.trim().replace(/\s+/g, " "),
        birthDate: form.birthDate,
        cpf: form.cpf.replace(/\D/g, ""),
        councilType: form.councilType,
        councilNumber: form.councilNumber.trim(),
        councilState: form.councilState.trim().toUpperCase() || null,
        status: form.status,
      }

      const res = await fetch(
        isEditing ? `/api/professionals/${initialData?.id}` : "/api/professionals",
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )

      const result = await res.json()

      if (!res.ok) {
        // Erros de unicidade/validação vêm do backend com `field` quando
        // aplicável — destacamos o campo sem expor detalhes internos.
        if (result?.field) {
          setFieldErrors((prev) => ({ ...prev, [result.field]: result.error }))
        }
        setError(result?.error || "Não foi possível salvar o profissional.")
        return
      }

      onSuccess()
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-10">
      <div className="relative mx-auto mb-10 w-full max-w-lg">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-blue-600" />
                <CardTitle>
                  {isEditing ? "Editar Usuário/Profissional" : "Novo Usuário/Profissional"}
                </CardTitle>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                onClick={onCancel}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <CardDescription>
              {isEditing
                ? "Alterações cadastrais não modificam o histórico já registrado nos atendimentos."
                : "Cadastre o profissional que poderá executar e finalizar atendimentos."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Nome completo *</Label>
                <Input
                  id="fullName"
                  placeholder="Ex.: João da Silva"
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                />
                {fieldErrors.fullName && (
                  <p className="text-sm text-red-500">{fieldErrors.fullName}</p>
                )}
                <p className="text-xs text-gray-400">
                  Informe o nome como deve aparecer no prontuário. Títulos como “Dr.” não são
                  adicionados automaticamente.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="birthDate">Data de nascimento *</Label>
                  <Input
                    id="birthDate"
                    type="date"
                    max={todayIso()}
                    value={form.birthDate}
                    onChange={(e) => set("birthDate", e.target.value)}
                  />
                  {fieldErrors.birthDate && (
                    <p className="text-sm text-red-500">{fieldErrors.birthDate}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cpf">CPF *</Label>
                  <Input
                    id="cpf"
                    placeholder="000.000.000-00"
                    maxLength={14}
                    value={form.cpf}
                    onChange={(e) => set("cpf", formatCpfInput(e.target.value))}
                  />
                  {fieldErrors.cpf && (
                    <p className="text-sm text-red-500">{fieldErrors.cpf}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="councilType">Conselho *</Label>
                  <select
                    id="councilType"
                    className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.councilType}
                    onChange={(e) => set("councilType", e.target.value)}
                  >
                    {COUNCIL_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.councilType && (
                    <p className="text-sm text-red-500">{fieldErrors.councilType}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="councilNumber">Número *</Label>
                  <Input
                    id="councilNumber"
                    placeholder="Ex.: 12345"
                    value={form.councilNumber}
                    onChange={(e) => set("councilNumber", e.target.value)}
                  />
                  {fieldErrors.councilNumber && (
                    <p className="text-sm text-red-500">{fieldErrors.councilNumber}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="councilState">UF</Label>
                  <select
                    id="councilState"
                    className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.councilState}
                    onChange={(e) => set("councilState", e.target.value)}
                  >
                    <option value="">—</option>
                    {BRAZILIAN_STATES.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.councilState && (
                    <p className="text-sm text-red-500">{fieldErrors.councilState}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  className="flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.status}
                  onChange={(e) => set("status", e.target.value as "active" | "inactive")}
                >
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
                <p className="text-xs text-gray-400">
                  Profissionais inativos permanecem no histórico, mas não aparecem em novos
                  atendimentos.
                </p>
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
                    "Cadastrar"
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

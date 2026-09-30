"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, X, Loader2 } from "lucide-react"
import { formatCPF } from "@/lib/schemas"

interface PatientAlertModalProps {
  patientId: string
  patientName: string
  cpf: string
  // Alertas clínicos estruturados já carregados pelo cabeçalho (anamnese).
  alerts?: Array<{ kind: string; text: string; detail?: string | null }>
  onClose: () => void
}

interface PatientDetails {
  fullName: string
  cpf: string
  healthNotes: string | null
}

export function PatientAlertModal({
  patientId,
  patientName,
  cpf,
  alerts = [],
  onClose,
}: PatientAlertModalProps) {
  const [notes, setNotes] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      setError("")
      try {
        const res = await fetch(`/api/patients/${patientId}`)
        if (res.ok) {
          const data: PatientDetails = await res.json()
          setNotes(data.healthNotes)
        } else {
          setError("Não foi possível carregar as observações do paciente.")
        }
      } catch {
        setError("Erro de conexão. Tente novamente.")
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [patientId])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 pt-16">
      <div className="relative mb-10 w-full max-w-lg mx-auto">
        <div className="rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Atenção — informações importantes
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
              <p className="font-medium text-gray-900">{patientName}</p>
              <p className="text-xs text-gray-500">CPF: {formatCPF(cpf)}</p>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-amber-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando observações...
                </div>
              ) : error ? (
                <p className="text-sm text-red-700">{error}</p>
              ) : notes && notes.trim() ? (
                <p className="whitespace-pre-wrap text-sm text-amber-900">{notes}</p>
              ) : (
                <p className="text-sm text-amber-800">
                  Nenhuma observação clínica registrada para este paciente.
                </p>
              )}
            </div>

            {/* Alertas estruturados registrados na ANAMNESE (Parte 4).
                O sistema apenas apresenta o que foi registrado — nada é
                inferido ou diagnosticado automaticamente. */}
            {alerts.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-red-800">
                  Alertas clínicos registrados na anamnese
                </p>
                <ul className="mt-2 space-y-1">
                  {alerts.map((alert, index) => (
                    <li
                      key={`${alert.kind}-${alert.text}-${index}`}
                      className="text-sm text-red-900"
                    >
                      <span className="font-medium">{alert.text}</span>
                      {alert.detail && (
                        <span className="block text-xs text-red-700/80">
                          {alert.detail}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-gray-400">
              Informação sensível. Trate com confidencialidade.
            </p>

            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

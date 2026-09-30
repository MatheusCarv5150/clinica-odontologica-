"use client"

import { useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, History, Loader2, X } from "lucide-react"
import { formatAnamnesisDateTime, formatResponsible } from "@/lib/anamnesis-domain"
import { useAsyncData } from "@/lib/use-async-data"

// ===========================================================================
// Histórico de alterações da anamnese (drawer lateral).
//
// Mostra "quem alterou / quando / o que mudou / valor anterior → novo valor",
// conforme registrado na trilha de auditoria do backend. Permite consultar a
// evolução clínica sem sair do atendimento (não é uma tela separada).
// ===========================================================================

interface HistoryEntry {
  id: string
  label: string
  field: string
  oldValue: string | null
  newValue: string | null
  changedAt: string
  changedByName: string | null
}

interface AnamnesisHistoryDrawerProps {
  attendanceId: string
  onClose: () => void
}

export function AnamnesisHistoryDrawer({
  attendanceId,
  onClose,
}: AnamnesisHistoryDrawerProps) {
  const load = useCallback(
    async () => {
      const res = await fetch(
        `/api/attendance/${attendanceId}/anamnesis/history`,
        { cache: "no-store" }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Não foi possível carregar o histórico.")
      }
      const payload = await res.json()
      return (Array.isArray(payload.entries)
        ? payload.entries
        : []) as HistoryEntry[]
    },
    [attendanceId]
  )

  const {
    data: entriesData,
    isLoading,
    error: loadError,
    reload,
  } = useAsyncData<HistoryEntry[]>(load, [attendanceId])

  const error = loadError ? "Não foi possível carregar o histórico." : ""
  const entries = entriesData ?? []

  // Fecha com ESC — comportamento esperado em drawer/modal.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Histórico de alterações da anamnese"
    >
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <History className="h-4 w-4 text-blue-600" />
            Histórico de alterações
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando histórico...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 py-6 text-center">
              <AlertTriangle className="h-6 w-6 text-red-400" />
              <p className="text-sm text-red-700">{error}</p>
              <Button variant="outline" size="sm" onClick={reload}>
                Tentar novamente
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center">
              <History className="mx-auto h-8 w-8 text-gray-300" />
              <p className="mt-2 text-sm font-medium text-gray-600">
                Nenhuma alteração registrada.
              </p>
              <p className="mt-1 text-xs text-gray-400">
                As próximas atualizações da anamnese aparecerão aqui.
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-lg border border-gray-200 p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {entry.label}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {formatAnamnesisDateTime(entry.changedAt)}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-gray-500">
                    Responsável: {formatResponsible(entry.changedByName)}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">
                      {formatValue(entry.oldValue)}
                    </span>
                    <span aria-hidden="true" className="text-gray-400">
                      →
                    </span>
                    <span className="rounded bg-blue-50 px-2 py-1 font-medium text-blue-800">
                      {formatValue(entry.newValue)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="border-t border-gray-100 px-5 py-3">
          <p className="text-[11px] text-gray-400">
            O histórico é preservado: alterações nunca apagam os valores anteriores.
          </p>
        </div>
      </div>
    </div>
  )
}

// Valores vazios são exibidos como "Nenhum" para deixar claro que o campo
// passou a ter (ou deixou de ter) informação.
function formatValue(value: string | null): string {
  if (value === null || value.trim().length === 0) return "Nenhum"
  return value
}

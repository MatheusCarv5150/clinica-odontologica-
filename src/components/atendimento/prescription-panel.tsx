"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Pill,
  Plus,
  Printer,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAsyncData } from "@/lib/use-async-data"
import {
  formatPrescriptionItemLine,
  getPrescriptionStatusMeta,
} from "@/lib/prescription-domain"
import type {
  PrescriptionView,
  PrescriptionsApiResponse,
} from "@/lib/schemas-prescription"
import { PrescriptionFormModal } from "./prescription-form-modal"

// ===========================================================================
// PRESCRIÇÃO — Parte 10.2.
//
// Ferramenta clínica prática: registrar prescrições vinculadas ao paciente e ao
// atendimento. Nenhum medicamento é sugerido/inserido automaticamente.
//
// - Histórico preservado: prescrições anteriores nunca são sobrescritas.
// - Cancelamento controlado (data/autor/motivo) em vez de exclusão.
// - Impressão estruturada (window.print) sem inventar dependências de PDF.
// ===========================================================================

interface PrescriptionPanelProps {
  attendanceId: string
  onChanged?: () => void
}

export function PrescriptionPanel({
  attendanceId,
  onChanged,
}: PrescriptionPanelProps) {
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [printing, setPrinting] = useState<PrescriptionView | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PrescriptionView | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/attendance/${attendanceId}/prescriptions`, {
      cache: "no-store",
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || "Não foi possível carregar as prescrições.")
    }
    return (await res.json()) as PrescriptionsApiResponse
  }, [attendanceId])

  const {
    data,
    error: loadError,
    isLoading,
    reload,
  } = useAsyncData<PrescriptionsApiResponse>(load, [attendanceId])

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  async function handleCancel(reason: string) {
    if (!cancelTarget) return
    setError("")
    setNotice("")
    try {
      const res = await fetch(
        `/api/attendance/${attendanceId}/prescriptions/${cancelTarget.id}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Não foi possível cancelar a prescrição.")
      }
      setNotice("Prescrição cancelada. O registro original foi preservado.")
      setCancelTarget(null)
      await reload()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cancelar.")
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-14 text-gray-400 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando prescrições...
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-sm font-medium text-red-800">
          {loadError || "Não foi possível carregar as prescrições."}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={reload}>
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Cabeçalho da área */}
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Prescrição</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Prescrições e orientações registradas no prontuário do paciente.
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
            <span>Paciente: {data.patient.fullName}</span>
            {data.appointment && (
              <span>
                Atendimento #{data.appointment.code} ·{" "}
                {new Date(
                  `${data.appointment.date}T00:00:00`
                ).toLocaleDateString("pt-BR")}
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setShowForm(true)}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nova prescrição
        </Button>
      </div>

      {/* Totalizadores */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Prescrições" value={data.totals.prescriptionsCount} />
        <MiniStat label="Emitidas" value={data.totals.issuedCount} />
        <MiniStat label="Canceladas" value={data.totals.cancelledCount} />
        <MiniStat label="Medicamentos" value={data.totals.itemsCount} />
      </div>

      {/* Feedback */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {notice}
        </div>
      )}

      {/* Histórico */}
      {data.prescriptions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <Pill className="mx-auto h-9 w-9 text-gray-300" />
          <p className="mt-2 text-sm font-medium text-gray-700">
            Nenhuma prescrição registrada
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
            Registre a prescrição vinculada a este atendimento. O sistema apenas
            registra o que o profissional informar.
          </p>
          <Button size="sm" className="mt-4" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            Criar prescrição
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {data.prescriptions.map((prescription) => (
            <PrescriptionCard
              key={prescription.id}
              prescription={prescription}
              expanded={expanded[prescription.id] ?? false}
              onToggle={() => toggle(prescription.id)}
              onPrint={() => setPrinting(prescription)}
              onCancel={
                prescription.status === "cancelled"
                  ? undefined
                  : () => setCancelTarget(prescription)
              }
            />
          ))}
        </div>
      )}

      {showForm && (
        <PrescriptionFormModal
          attendanceId={attendanceId}
          onClose={() => setShowForm(false)}
          onSaved={async (message) => {
            setShowForm(false)
            setNotice(message)
            await reload()
            onChanged?.()
          }}
        />
      )}

      {cancelTarget && (
        <CancelPrescriptionModal
          onClose={() => setCancelTarget(null)}
          onConfirm={handleCancel}
        />
      )}

      {printing && (
        <PrescriptionPrintView
          prescription={printing}
          patientName={data.patient.fullName}
          appointmentCode={data.appointment?.code ?? null}
          onClose={() => setPrinting(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
          {label}
        </p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
      </CardContent>
    </Card>
  )
}

function PrescriptionCard({
  prescription,
  expanded,
  onToggle,
  onPrint,
  onCancel,
}: {
  prescription: PrescriptionView
  expanded: boolean
  onToggle: () => void
  onPrint: () => void
  onCancel?: () => void
}) {
  const statusMeta = getPrescriptionStatusMeta(prescription.status)

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1.5 text-left"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-gray-400 transition-transform",
                  !expanded && "-rotate-90"
                )}
              />
              <span className="text-sm font-semibold text-gray-900">
                {prescription.items.length}{" "}
                {prescription.items.length === 1 ? "medicamento" : "medicamentos"}
              </span>
            </button>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                statusMeta.className
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dot)} />
              {statusMeta.label}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
            <span>
              {new Date(prescription.createdAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {prescription.professionalName && (
              <span>{prescription.professionalName}</span>
            )}
            {prescription.appointmentCode && (
              <span>Atendimento #{prescription.appointmentCode}</span>
            )}
          </div>

          {!expanded && prescription.items.length > 0 && (
            <p className="mt-1.5 truncate text-xs text-gray-600">
              {prescription.items
                .slice(0, 3)
                .map((item) => item.name)
                .join(", ")}
              {prescription.items.length > 3 ? "…" : ""}
            </p>
          )}

          {prescription.status === "cancelled" && prescription.cancelReason && (
            <p className="mt-1.5 rounded-md border border-red-100 bg-red-50 px-2 py-1 text-[11px] text-red-700">
              Cancelada: {prescription.cancelReason}
              {prescription.cancelledByName
                ? ` · ${prescription.cancelledByName}`
                : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onToggle}>
            <FileText className="h-3.5 w-3.5" />
            {expanded ? "Ocultar" : "Visualizar"}
          </Button>
          <Button variant="outline" size="sm" onClick={onPrint}>
            <Printer className="h-3.5 w-3.5" />
            Imprimir
          </Button>
          {onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              <Ban className="h-3.5 w-3.5" />
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4">
          <ul className="space-y-2">
            {prescription.items.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-gray-200 bg-white p-3"
              >
                <p className="text-sm font-semibold text-gray-900">
                  {formatPrescriptionItemLine(item)}
                </p>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-600 sm:grid-cols-3">
                  {item.activeIngredient && (
                    <Detail label="Princípio ativo" value={item.activeIngredient} />
                  )}
                  {item.presentation && (
                    <Detail label="Apresentação" value={item.presentation} />
                  )}
                  {item.concentration && (
                    <Detail label="Concentração" value={item.concentration} />
                  )}
                  {item.route && <Detail label="Via" value={item.route} />}
                  {item.dose && <Detail label="Dose" value={item.dose} />}
                  {item.frequency && (
                    <Detail label="Frequência" value={item.frequency} />
                  )}
                  {item.duration && <Detail label="Duração" value={item.duration} />}
                  {item.quantity !== null && (
                    <Detail
                      label="Quantidade"
                      value={`${item.quantity} ${item.unit ?? ""}`.trim()}
                    />
                  )}
                </dl>
                {item.instructions && (
                  <p className="mt-1.5 text-xs text-gray-700">
                    <span className="font-medium">Instruções:</span>{" "}
                    {item.instructions}
                  </p>
                )}
                {item.observations && (
                  <p className="mt-1 text-xs text-gray-500">
                    <span className="font-medium">Obs.:</span> {item.observations}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {(prescription.guidance || prescription.notes) && (
            <div className="mt-3 space-y-1.5 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700">
              {prescription.guidance && (
                <p>
                  <span className="font-semibold">Orientações:</span>{" "}
                  {prescription.guidance}
                </p>
              )}
              {prescription.notes && (
                <p>
                  <span className="font-semibold">Observações:</span>{" "}
                  {prescription.notes}
                </p>
              )}
            </div>
          )}

          {/* Auditoria */}
          {prescription.logs.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] font-medium text-gray-500">
                Histórico ({prescription.logs.length})
              </summary>
              <ul className="mt-1.5 space-y-1">
                {prescription.logs.map((log) => (
                  <li key={log.id} className="text-[11px] text-gray-500">
                    {log.label} ·{" "}
                    {new Date(log.createdAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {log.performedByName ? ` · ${log.performedByName}` : ""}
                    {log.notes ? ` — ${log.notes}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-gray-400">{label}</dt>
      <dd className="text-gray-700">{value}</dd>
    </div>
  )
}

function CancelPrescriptionModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-100 px-5 py-3.5">
          <h4 className="text-base font-semibold text-gray-900">
            Cancelar prescrição
          </h4>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-gray-600">
            A prescrição <strong>não será apagada</strong>: ela ficará marcada
            como cancelada, preservando o registro no prontuário.
          </p>
          {error && (
            <p className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Motivo do cancelamento (obrigatório)."
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3.5">
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button
            onClick={() => {
              if (reason.trim().length < 3) {
                setError("Informe o motivo do cancelamento.")
                return
              }
              onConfirm(reason.trim())
            }}
          >
            Confirmar cancelamento
          </Button>
        </div>
      </div>
    </div>
  )
}

// Impressão estruturada: abre uma janela dedicada com o conteúdo da prescrição.
// A arquitetura está pronta para geração de PDF/assinatura futura; aqui usamos
// apenas o recurso nativo do navegador, sem adicionar dependências.
function PrescriptionPrintView({
  prescription,
  patientName,
  appointmentCode,
  onClose,
}: {
  prescription: PrescriptionView
  patientName: string
  appointmentCode: string | null
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h4 className="text-base font-semibold text-gray-900">
            Visualizar prescrição
          </h4>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
              Imprimir
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
        <div className="space-y-4 p-6">
          <div className="border-b border-gray-200 pb-3">
            <p className="text-lg font-bold text-gray-900">Receituário</p>
            <p className="text-sm text-gray-600">Paciente: {patientName}</p>
            {appointmentCode && (
              <p className="text-xs text-gray-500">
                Atendimento #{appointmentCode}
              </p>
            )}
            <p className="text-xs text-gray-500">
              {new Date(prescription.createdAt).toLocaleString("pt-BR")}
              {prescription.professionalName
                ? ` · ${prescription.professionalName}`
                : ""}
            </p>
          </div>

          <ol className="list-decimal space-y-3 pl-5">
            {prescription.items.map((item) => (
              <li key={item.id} className="text-sm text-gray-800">
                <p className="font-semibold">{item.name}</p>
                <p className="text-xs text-gray-600">
                  {formatPrescriptionItemLine(item)}
                </p>
                {item.instructions && (
                  <p className="text-xs text-gray-600">{item.instructions}</p>
                )}
              </li>
            ))}
          </ol>

          {prescription.guidance && (
            <p className="border-t border-gray-200 pt-3 text-sm text-gray-700">
              <span className="font-semibold">Orientações:</span>{" "}
              {prescription.guidance}
            </p>
          )}

          <div className="pt-8 text-center">
            <div className="mx-auto w-64 border-t border-gray-400 pt-1 text-xs text-gray-500">
              {prescription.professionalName || "Assinatura do profissional"}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

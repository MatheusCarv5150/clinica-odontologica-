"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  User,
  X,
} from "lucide-react"
import type {
  FinalizationPendingView,
  FinalizationPreviewResponse,
} from "@/lib/schemas-finalization"
import { cn } from "@/lib/utils"
import type { ProntuarioSection } from "./prontuario-sidebar"

// ===========================================================================
// FINALIZAÇÃO DO ATENDIMENTO — Parte 9.
//
// Não é um simples botão de mudança de status: é o mecanismo que transforma o
// atendimento em um registro oficial do prontuário. O fluxo é:
//
//   [Finalizar atendimento] → etapa de REVISÃO → validação de pendências →
//   confirmação → finalização (transação) → registro FECHADO.
//
// O componente apenas APRESENTA a avaliação produzida pelo backend; nenhuma
// regra de "pode finalizar?" é decidida aqui.
// ===========================================================================

interface FinalizationPanelProps {
  attendanceId: string
  patientName: string
  /** Usuário/profissional autenticado (identidade textual do prontuário). */
  responsibleName: string
  /**
   * Profissional CADASTRADO vinculado ao atendimento (quando existir). É a
   * fonte AUTORITATIVA da identidade: o backend resolve nome e conselho a
   * partir do cadastro e os congela no histórico da finalização.
   */
  professionalId?: string | null
  /** Atendimento já finalizado (a UI reabre em modo leitura). */
  isFinalized: boolean
  onFinalized: () => void
  /** Navega para a seção do prontuário onde a pendência deve ser corrigida. */
  onNavigate: (section: ProntuarioSection) => void
  onClose: () => void
}

export function FinalizationPanel({
  attendanceId,
  patientName,
  responsibleName,
  professionalId = null,
  isFinalized,
  onFinalized,
  onNavigate,
  onClose,
}: FinalizationPanelProps) {
  const [preview, setPreview] = useState<FinalizationPreviewResponse | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [error, setError] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  // O profissional responsável pode já estar definido (ex.: profissional do
  // atendimento). Se não estiver, é coletado aqui — a validação definitiva é
  // sempre do backend.
  const [name, setName] = useState(responsibleName)

  // Carrega a avaliação de pendências (etapa de revisão).
  const loadPreview = useCallback(async () => {
    if (!name.trim()) {
      setIsLoading(false)
      setPreview(null)
      return
    }
    setIsLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/attendance/${attendanceId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responsibleName: name.trim(),
          professionalId,
          preview: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Erro ao revisar o atendimento.")
      }
      setPreview(data as FinalizationPreviewResponse)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erro ao revisar o atendimento."
      )
    } finally {
      setIsLoading(false)
    }
  }, [attendanceId, name, professionalId])

  useEffect(() => {
    // Adia a chamada para fora do corpo síncrono do efeito: evita renders em
    // cascata (react-hooks/set-state-in-effect) mantendo o carregamento.
    const id = setTimeout(() => void loadPreview(), 0)
    return () => clearTimeout(id)
  }, [loadPreview])

  async function handleFinalize() {
    if (!confirmed || !name.trim()) return
    setIsFinalizing(true)
    setError("")
    try {
      const res = await fetch(`/api/attendance/${attendanceId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responsibleName: name.trim(),
          professionalId,
          preview: false,
          confirmed: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Pendências descobertas na finalização: recarrega a revisão.
        setError(data.error || "Não foi possível finalizar o atendimento.")
        await loadPreview()
        return
      }
      onFinalized()
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setIsFinalizing(false)
    }
  }

  const summary = preview?.summary
  const blocking = preview?.blocking ?? []
  const warnings = preview?.warnings ?? []
  const info = preview?.info ?? []
  const canFinalize = !!preview?.canFinalize

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="finalize-title"
    >
      <div className="my-auto w-full max-w-2xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full",
                isFinalized
                  ? "bg-gray-100 text-gray-500"
                  : "bg-blue-100 text-blue-700"
              )}
            >
              {isFinalized ? (
                <Lock className="h-5 w-5" />
              ) : (
                <ClipboardCheck className="h-5 w-5" />
              )}
            </div>
            <div>
              <h2
                id="finalize-title"
                className="text-base font-semibold text-gray-900"
              >
                {isFinalized
                  ? "Atendimento finalizado"
                  : "Finalizar atendimento"}
              </h2>
              <p className="text-xs text-gray-500">
                {isFinalized
                  ? "O registro clínico deste atendimento está fechado."
                  : "Revise as informações antes de concluir."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corpo */}
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* Identificação do profissional responsável (quando ausente).
              Sem ele não há revisão — a obrigatoriedade vem do backend. */}
          {!isFinalized && !responsibleName && (
            <section aria-label="Profissional responsável">
              <Label
                htmlFor="finalize-responsible"
                className="text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Profissional responsável
              </Label>
              <Input
                id="finalize-responsible"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do profissional que realizou o atendimento"
                className="mt-1.5"
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-gray-500">
                Obrigatório para registrar quem finalizou o atendimento. O
                horário de encerramento é gerado pelo servidor.
              </p>
            </section>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              Revisando o atendimento...
            </div>
          ) : error && !preview ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void loadPreview()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Tentar novamente
              </Button>
            </div>
          ) : preview && summary ? (
            <>
              {/* Resumo do atendimento */}
              <section aria-label="Resumo do atendimento">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Resumo
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <SummaryRow
                    icon={<User className="h-4 w-4 text-gray-400" />}
                    label="Paciente"
                    value={summary.patientName ?? patientName}
                  />
                  <SummaryRow
                    icon={<Stethoscope className="h-4 w-4 text-gray-400" />}
                    label="Profissional"
                    value={name || "Não informado"}
                  />
                  <SummaryRow
                    icon={<Clock className="h-4 w-4 text-gray-400" />}
                    label="Início"
                    value={formatDateTime(summary.startedAt)}
                  />
                  <SummaryRow
                    icon={<Clock className="h-4 w-4 text-gray-400" />}
                    label="Duração"
                    value={summary.durationLabel ?? "Não disponível"}
                  />
                </div>
              </section>

              {/* Consolidação clínica */}
              <section aria-label="Consolidação clínica">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Consolidação clínica
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatCard
                    label="Previstos"
                    value={summary.proceduresScheduled}
                  />
                  <StatCard
                    label="Realizados"
                    value={summary.proceduresPerformed}
                    tone="positive"
                  />
                  <StatCard
                    label="Não realizados"
                    value={summary.proceduresNotPerformed}
                  />
                  <StatCard
                    label="Pendentes"
                    value={summary.proceduresPending}
                    tone={summary.proceduresPending > 0 ? "warning" : "default"}
                  />
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <CheckRow
                    label="Registro clínico"
                    ok={summary.recordFilled}
                  />
                  <CheckRow
                    label="Evolução"
                    ok={summary.evolutionRegistered}
                  />
                  <CheckRow
                    label="Odontograma"
                    ok={summary.odontogramUpdated}
                  />
                </div>
              </section>

              {/* Pendências bloqueantes */}
              {blocking.length > 0 && (
                <PendingGroup
                  title="Itens que impedem a finalização"
                  tone="blocking"
                  items={blocking}
                  onNavigate={onNavigate}
                />
              )}

              {/* Pendências não bloqueantes */}
              {warnings.length > 0 && (
                <PendingGroup
                  title="Itens que precisam de atenção"
                  tone="warning"
                  items={warnings}
                  onNavigate={onNavigate}
                />
              )}

              {/* Informativos */}
              {info.length > 0 && (
                <PendingGroup
                  title="Informações"
                  tone="info"
                  items={info}
                  onNavigate={onNavigate}
                />
              )}

              {/* Confirmação (apenas quando pode finalizar) */}
              {canFinalize && !isFinalized && (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-blue-900">
                    Revisei as informações deste atendimento e confirmo a
                    finalização. Após finalizar, o registro clínico será fechado
                    e não poderá ser editado livremente.
                  </span>
                </label>
              )}

              {/* Erro de ação (ex.: pendência surgida na finalização) */}
              {error && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Rodapé / ações */}
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3 sm:flex-row sm:justify-end">
          {isFinalized ? (
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isFinalizing}
              >
                Voltar
              </Button>
              {canFinalize ? (
                <Button
                  onClick={() => void handleFinalize()}
                  disabled={!confirmed || isFinalizing}
                >
                  {isFinalizing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Finalizando...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4" />
                      Revisar e finalizar
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    const target = blocking[0]
                    if (target) navigateForAction(target, onNavigate)
                  }}
                >
                  Corrigir pendências
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subcomponentes de apresentação
// ---------------------------------------------------------------------------

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
      {icon}
      <span className="text-xs text-gray-500">{label}</span>
      <span className="ml-auto truncate text-sm font-medium text-gray-900">
        {value}
      </span>
    </div>
  )
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: number
  tone?: "default" | "positive" | "warning"
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-center",
        tone === "positive"
          ? "border-green-200 bg-green-50"
          : tone === "warning"
          ? "border-amber-200 bg-amber-50"
          : "border-gray-100 bg-white"
      )}
    >
      <div
        className={cn(
          "text-lg font-semibold",
          tone === "positive"
            ? "text-green-700"
            : tone === "warning"
            ? "text-amber-700"
            : "text-gray-900"
        )}
      >
        {value}
      </div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  )
}

function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
      )}
      <span className="text-gray-700">{label}</span>
      <span
        className={cn(
          "ml-auto text-xs font-medium",
          ok ? "text-green-700" : "text-amber-700"
        )}
      >
        {ok ? "OK" : "Pendente"}
      </span>
    </div>
  )
}

function PendingGroup({
  title,
  tone,
  items,
  onNavigate,
}: {
  title: string
  tone: "blocking" | "warning" | "info"
  items: FinalizationPendingView[]
  onNavigate: (section: ProntuarioSection) => void
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li
            key={`${item.code}-${index}`}
            className={cn(
              "rounded-lg border p-3",
              tone === "blocking"
                ? "border-red-200 bg-red-50"
                : tone === "warning"
                ? "border-amber-200 bg-amber-50"
                : "border-gray-200 bg-gray-50"
            )}
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">
                {tone === "blocking" ? (
                  <Ban className="h-4 w-4 text-red-600" />
                ) : tone === "warning" ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                ) : (
                  <Info className="h-4 w-4 text-gray-500" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    tone === "blocking"
                      ? "text-red-800"
                      : tone === "warning"
                      ? "text-amber-800"
                      : "text-gray-700"
                  )}
                >
                  {item.title}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-xs",
                    tone === "blocking"
                      ? "text-red-700"
                      : tone === "warning"
                      ? "text-amber-700"
                      : "text-gray-500"
                  )}
                >
                  {item.description}
                </p>
              </div>
              {item.action !== "none" && (
                <button
                  type="button"
                  onClick={() => navigateForAction(item, onNavigate)}
                  className={cn(
                    "shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                    tone === "blocking"
                      ? "border-red-300 bg-white text-red-700 hover:bg-red-100"
                      : "border-amber-300 bg-white text-amber-700 hover:bg-amber-100"
                  )}
                >
                  Revisar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function navigateForAction(
  item: FinalizationPendingView,
  onNavigate: (section: ProntuarioSection) => void
) {
  switch (item.action) {
    case "go_procedures":
      onNavigate("procedimentos")
      break
    case "go_record":
      onNavigate("registro")
      break
    case "go_evolution":
      onNavigate("evolucao")
      break
    case "go_odontogram":
      onNavigate("odontograma")
      break
    case "go_anamnesis":
      onNavigate("anamnese")
      break
    default:
      break
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return "Não registrado"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Não registrado"
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  AlertTriangle,
  ClipboardList,
  FileCheck,
  FileText,
  Loader2,
  Save,
  ShieldCheck,
  Stethoscope,
} from "lucide-react"
import {
  AttendanceSummary,
  EvolutionSectionCard,
  FreeTextField,
  IntercurrentToggle,
  ProcedureRecordList,
  ToothReference,
} from "./evolution-ui"
import type { EvolutionResponse, SaveEvolutionInput } from "@/lib/schemas-evolution"
import { useAsyncData } from "@/lib/use-async-data"

// ===========================================================================
// EVOLUÇÃO CLÍNICA — Parte 6.
//
// Registro clínico oficial do atendimento. O profissional documenta:
// - Queixa / motivo
// - Achados clínicos
// - Avaliação / diagnóstico
// - Conduta
// - Procedimentos realizados
// - Evolução clínica
// - Orientações ao paciente
// - Intercorrências
// - Observações adicionais
//
// O registro pode ser salvo como rascunho ou finalizado.
// Após a finalização, alterações exigem rastreabilidade.
// ===========================================================================

interface EvolutionPanelProps {
  attendanceId: string
  onSaved?: () => void
  onFinalized?: () => void
}

/** Procedimento em edição dentro da evolução clínica. */
interface ProcedureDraft {
  id: string
  procedureId: string
  procedureNameSnapshot: string
  toothNumber: string | null
  dentition: string | null
  surfaces: string[]
  status: string
  material: string | null
  notes: string | null
}

/** Campos de um procedimento pelos quais updateProcedure pode atualizar. */
type ProcedureDraftKey = keyof ProcedureDraft

type SectionKey =
  | "chiefComplaint"
  | "clinicalFindings"
  | "evaluation"
  | "conduct"
  | "procedures"
  | "evolution"
  | "guidance"
  | "intercurrent"
  | "observations"

interface SectionState {
  key: SectionKey
  title: string
  description: string
  icon: React.ReactNode
  open: boolean
}

const SECTIONS: SectionState[] = [
  {
    key: "chiefComplaint",
    title: "Queixa / Motivo da consulta",
    description: "Motivo pelo qual o paciente está sendo atendido.",
    icon: <ClipboardList className="h-4 w-4" />,
    open: true,
  },
  {
    key: "clinicalFindings",
    title: "Achados clínicos",
    description: "O que foi observado durante a avaliação.",
    icon: <Stethoscope className="h-4 w-4" />,
    open: true,
  },
  {
    key: "evaluation",
    title: "Avaliação / Diagnóstico",
    description: "Conclusão clínica registrada pelo profissional.",
    icon: <FileText className="h-4 w-4" />,
    open: true,
  },
  {
    key: "conduct",
    title: "Conduta",
    description: "O que foi decidido ou realizado.",
    icon: <ShieldCheck className="h-4 w-4" />,
    open: true,
  },
  {
    key: "procedures",
    title: "Procedimentos realizados",
    description: "Procedimentos efetivamente executados neste atendimento.",
    icon: <Stethoscope className="h-4 w-4" />,
    open: true,
  },
  {
    key: "evolution",
    title: "Evolução clínica",
    description: "Como o paciente evoluiu durante o atendimento.",
    icon: <FileText className="h-4 w-4" />,
    open: true,
  },
  {
    key: "guidance",
    title: "Orientações ao paciente",
    description: "Cuidados, higiene, alimentação e recomendações.",
    icon: <FileText className="h-4 w-4" />,
    open: true,
  },
  {
    key: "intercurrent",
    title: "Intercorrências",
    description: "Eventos adversos ou imprevistos durante o atendimento.",
    icon: <AlertTriangle className="h-4 w-4" />,
    open: true,
  },
  {
    key: "observations",
    title: "Observações adicionais",
    description: "Informações complementares relevantes.",
    icon: <FileText className="h-4 w-4" />,
    open: false,
  },
]

export function EvolutionPanel({
  attendanceId,
  onSaved,
  onFinalized,
}: EvolutionPanelProps) {
  const [actionError, setActionError] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false)
  const [responsibleName, setResponsibleName] = useState("")

  // Estado local para os campos de texto.
  const [chiefComplaint, setChiefComplaint] = useState("")
  const [clinicalFindings, setClinicalFindings] = useState("")
  const [evaluation, setEvaluation] = useState("")
  const [conduct, setConduct] = useState("")
  const [evolutionText, setEvolutionText] = useState("")
  const [guidance, setGuidance] = useState("")
  const [intercurrentHas, setIntercurrentHas] = useState(false)
  const [intercurrentDesc, setIntercurrentDesc] = useState("")
  const [observations, setObservations] = useState("")

  // Procedimentos locais (lista editável).
  const [procedures, setProcedures] = useState<ProcedureDraft[]>([])

  // Estado das seções expansíveis.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => {
      const initial: Record<string, boolean> = {}
      SECTIONS.forEach((s) => {
        initial[s.key] = s.open
      })
      return initial
    }
  )

  // Carrega os dados da evolução.
  const loadEvolution = useCallback(async () => {
    const res = await fetch(`/api/attendance/${attendanceId}/evolution`, {
      cache: "no-store",
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || "Erro ao carregar a evolução.")
    }
    return (await res.json()) as EvolutionResponse
  }, [attendanceId])

  const {
    data,
    isLoading,
    error: loadError,
    reload: reloadEvolution,
  } = useAsyncData<EvolutionResponse>(loadEvolution, [attendanceId])

  // Distribui os dados recebidos pelos campos editáveis do formulário usando o
  // padrão de "ajustar estado durante a renderização" — sem efeito e sem
  // render extra, e só quando um payload novo chega.
  const [hydratedFrom, setHydratedFrom] = useState<EvolutionResponse | null>(
    null
  )

  if (data && data !== hydratedFrom) {
    setHydratedFrom(data)

    // Preenche os campos locais com os dados existentes.
    if (data.evolution) {
      setChiefComplaint(data.evolution.chiefComplaint ?? "")
      setClinicalFindings(data.evolution.clinicalFindings ?? "")
      setEvaluation(data.evolution.evaluation ?? "")
      setConduct(data.evolution.conduct ?? "")
      setEvolutionText(data.evolution.evolution ?? "")
      setGuidance(data.evolution.guidance ?? "")
      setIntercurrentHas(data.evolution.intercurrentHas)
      setIntercurrentDesc(data.evolution.intercurrentDescription ?? "")
      setObservations(data.evolution.observations ?? "")
    } else if (data.anamnesisRef?.chiefComplaint) {
      // Pré-preenchimento da queixa a partir da anamnese (sugestão, não
      // obrigatório). Só ocorre quando ainda não existe evolução salva, e o
      // profissional pode editar livremente o texto sugerido.
      setChiefComplaint(`Paciente relata: ${data.anamnesisRef.chiefComplaint}.`)
    }

    // Preenche os procedimentos existentes.
    if (data.evolution?.procedures) {
      setProcedures(
        data.evolution.procedures.map((p) => ({
          id: p.id,
          procedureId: p.procedureId,
          procedureNameSnapshot: p.procedureNameSnapshot,
          toothNumber: p.toothNumber,
          dentition: p.dentition,
          surfaces: p.surfaces,
          status: p.status,
          material: p.material,
          notes: p.notes,
        }))
      )
    }
  }

  function toggleSection(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // Adiciona um novo procedimento vazio à lista.
  function addProcedure() {
    setProcedures((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        procedureId: "",
        procedureNameSnapshot: "",
        toothNumber: null,
        dentition: null,
        surfaces: [],
        status: "performed",
        material: null,
        notes: null,
      },
    ])
  }

  // Atualiza um procedimento na lista.
  function updateProcedure(
    index: number,
    field: ProcedureDraftKey,
    value: ProcedureDraft[ProcedureDraftKey]
  ) {
    setProcedures((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  // Remove um procedimento da lista.
  function removeProcedure(index: number) {
    setProcedures((prev) => prev.filter((_, i) => i !== index))
  }

  // Monta o payload para salvar.
  function buildPayload(): SaveEvolutionInput {
    return {
      chiefComplaint: { text: chiefComplaint || null },
      clinicalFindings: { text: clinicalFindings || null },
      evaluation: { text: evaluation || null },
      conduct: { text: conduct || null },
      procedures: procedures
        .filter((p) => p.procedureId && p.procedureNameSnapshot)
        .map((p) => ({
          procedureId: p.procedureId,
          procedureNameSnapshot: p.procedureNameSnapshot,
          toothNumber: p.toothNumber || undefined,
          dentition: (p.dentition || undefined) as "permanent" | "deciduous" | undefined,
          surfaces: p.surfaces,
          status: p.status as "planned" | "performed" | "not_performed" | "cancelled",
          material: p.material,
          notes: p.notes,
        })),
      evolution: { text: evolutionText || null },
      guidance: { text: guidance || null },
      intercurrent: {
        hasIntercurrent: intercurrentHas,
        description: intercurrentHas ? intercurrentDesc : null,
      },
      observations: { text: observations || null },
      responsibleName: responsibleName || null,
      finalize: false,
    }
  }

  // Salva a evolução (rascunho).
  async function handleSave() {
    setIsSaving(true)
    setActionError("")
    try {
      const payload = buildPayload()
      const res = await fetch(`/api/attendance/${attendanceId}/evolution`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        await loadEvolution()
        onSaved?.()
        return
      }

      const err = await res.json().catch(() => ({}))
      setActionError(err.error || "Erro ao salvar a evolução.")
    } catch {
      setActionError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }

  // Finaliza o atendimento.
  async function handleFinalize() {
    if (!responsibleName.trim()) {
      setActionError("O nome do profissional é obrigatório para finalizar.")
      return
    }

    setIsFinalizing(true)
    setActionError("")
    try {
      // Primeiro salva como rascunho (se necessário).
      const payload = buildPayload()
      payload.finalize = true
      payload.responsibleName = responsibleName.trim()

      const res = await fetch(`/api/attendance/${attendanceId}/evolution`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setActionError(err.error || "Erro ao salvar antes de finalizar.")
        return
      }

      // Depois finaliza.
      const finalizeRes = await fetch(
        `/api/attendance/${attendanceId}/evolution/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ responsibleName: responsibleName.trim() }),
        }
      )

      if (finalizeRes.ok) {
        setShowFinalizeConfirm(false)
        await reloadEvolution()
        onFinalized?.()
        return
      }

      const err = await finalizeRes.json().catch(() => ({}))
      setActionError(err.error || "Erro ao finalizar o atendimento.")
    } catch {
      setActionError("Erro de conexão. Tente novamente.")
    } finally {
      setIsFinalizing(false)
    }
  }

  // --- Estados de carregamento/erro ---
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-14 text-sm text-gray-400 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando evolução...
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-sm font-medium text-red-800">
          {loadError || "Evolução não encontrada."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={reloadEvolution}>
            Tentar novamente
          </Button>
        </div>
      </div>
    )
  }

  const isFinalized = data.evolution?.finalized ?? false

  return (
    <div className="space-y-5">
      {/* Resumo do atendimento */}
      <AttendanceSummary
        patientName={data.patient.fullName}
        age={data.patient.age}
        appointmentCode={data.appointment.code}
        date={data.appointment.date}
        time={data.appointment.time}
        professionalName={data.professional?.name ?? null}
        status={data.appointment.status}
        proceduresScheduled={data.proceduresScheduled}
      />

      {/* Alerta de finalização */}
      {isFinalized && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4"
          role="status"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Atendimento finalizado
              </p>
              <p className="text-xs text-amber-700">
                Este registro está finalizado. Alterações importantes exigem
                registro de correção/auditoria.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Erro de ação */}
      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {actionError}
        </div>
      )}

      {/* Seções de registro clínico */}
      <div className="space-y-4">
        {SECTIONS.map((section) => (
          <EvolutionSectionCard
            key={section.key}
            id={section.key}
            title={section.title}
            description={section.description}
            icon={section.icon}
            isOpen={openSections[section.key] ?? false}
            onToggle={() => toggleSection(section.key)}
          >
            {/* Conteúdo de cada seção */}
            {section.key === "chiefComplaint" && (
              <FreeTextField
                label="Queixa principal / Motivo da consulta"
                description="O motivo pelo qual o paciente está sendo atendido. Pode ser pré-preenchido a partir da anamnese."
                value={chiefComplaint}
                onChange={setChiefComplaint}
                placeholder="Ex.: Paciente comparece relatando dor no dente 26."
                rows={3}
                disabled={isFinalized}
              />
            )}

            {section.key === "clinicalFindings" && (
              <FreeTextField
                label="Achados clínicos"
                description="O que foi observado durante a avaliação clínica."
                value={clinicalFindings}
                onChange={setClinicalFindings}
                placeholder="Ex.: Avaliação clínica identificou lesão cariosa em região oclusal do dente 26."
                rows={4}
                disabled={isFinalized}
              />
            )}

            {section.key === "evaluation" && (
              <FreeTextField
                label="Avaliação / Diagnóstico"
                description="Conclusão clínica registrada pelo profissional. O sistema NÃO diagnostica automaticamente."
                value={evaluation}
                onChange={setEvaluation}
                placeholder="Ex.: Lesão cariosa oclusal no dente 26, compatível com cárie moderada."
                rows={4}
                disabled={isFinalized}
              />
            )}

            {section.key === "conduct" && (
              <FreeTextField
                label="Conduta"
                description="O que foi decidido ou realizado durante o atendimento."
                value={conduct}
                onChange={setConduct}
                placeholder="Ex.: Realizada restauração em resina composta."
                rows={3}
                disabled={isFinalized}
              />
            )}

            {section.key === "procedures" && (
              <div className="space-y-4">
                {/* Lista de procedimentos registrados */}
                <ProcedureRecordList
                  procedures={procedures.map((p) => ({
                    id: p.id,
                    procedureId: p.procedureId,
                    procedureNameSnapshot: p.procedureNameSnapshot,
                    toothNumber: p.toothNumber,
                    dentition: p.dentition,
                    surfaces: p.surfaces,
                    status: p.status,
                    material: p.material,
                    notes: p.notes,
                    professionalName: null,
                    occurredAt: new Date().toISOString(),
                  }))}
                  onRemove={(id) => {
                    const idx = procedures.findIndex((p) => p.id === id)
                    if (idx >= 0) removeProcedure(idx)
                  }}
                  disabled={isFinalized}
                />

                {/* Formulário para adicionar procedimento */}
                {!isFinalized && (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-4">
                    <p className="mb-3 text-xs font-medium text-gray-500">
                      Adicionar procedimento
                    </p>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600">
                          Procedimento (catálogo)
                        </label>
                        <input
                          type="text"
                          value={
                            procedures[procedures.length - 1]
                              ?.procedureNameSnapshot ?? ""
                          }
                          onChange={(e) => {
                            const lastIdx = procedures.length - 1
                            updateProcedure(lastIdx, "procedureNameSnapshot", e.target.value)
                          }}
                          placeholder="Nome do procedimento"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-600">
                          ID do procedimento (catálogo)
                        </label>
                        <input
                          type="text"
                          value={
                            procedures[procedures.length - 1]
                              ?.procedureId ?? ""
                          }
                          onChange={(e) => {
                            const lastIdx = procedures.length - 1
                            updateProcedure(lastIdx, "procedureId", e.target.value)
                          }}
                          placeholder="ID no catálogo"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>

                      <ToothReference
                        toothNumber={
                          procedures[procedures.length - 1]?.toothNumber ?? null
                        }
                        dentition={
                          procedures[procedures.length - 1]?.dentition ?? null
                        }
                        surfaces={
                          procedures[procedures.length - 1]?.surfaces ?? []
                        }
                        onChange={(d) => {
                          const lastIdx = procedures.length - 1
                          updateProcedure(lastIdx, "toothNumber", d.toothNumber)
                          updateProcedure(lastIdx, "dentition", d.dentition)
                          updateProcedure(lastIdx, "surfaces", d.surfaces)
                        }}
                        disabled={isFinalized}
                      />

                      <div>
                        <label className="block text-xs font-medium text-gray-600">
                          Status
                        </label>
                        <select
                          value={
                            procedures[procedures.length - 1]?.status ?? "performed"
                          }
                          onChange={(e) => {
                            const lastIdx = procedures.length - 1
                            updateProcedure(lastIdx, "status", e.target.value)
                          }}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="performed">Realizado</option>
                          <option value="planned">Planejado</option>
                          <option value="not_performed">Não realizado</option>
                          <option value="cancelled">Cancelado</option>
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-gray-600">
                          Material utilizado (opcional)
                        </label>
                        <input
                          type="text"
                          value={
                            procedures[procedures.length - 1]?.material ?? ""
                          }
                          onChange={(e) => {
                            const lastIdx = procedures.length - 1
                            updateProcedure(lastIdx, "material", e.target.value || null)
                          }}
                          placeholder="Ex.: Resina composta A2"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-gray-600">
                          Observação do procedimento
                        </label>
                        <input
                          type="text"
                          value={
                            procedures[procedures.length - 1]?.notes ?? ""
                          }
                          onChange={(e) => {
                            const lastIdx = procedures.length - 1
                            updateProcedure(lastIdx, "notes", e.target.value || null)
                          }}
                          placeholder="Observação clínica sobre este procedimento"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {!isFinalized && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addProcedure}
                  >
                    + Registrar procedimento
                  </Button>
                )}
              </div>
            )}

            {section.key === "evolution" && (
              <FreeTextField
                label="Evolução clínica"
                description="Como o paciente evoluiu durante o atendimento."
                value={evolutionText}
                onChange={setEvolutionText}
                placeholder="Ex.: Paciente apresentou boa tolerância ao procedimento, sem intercorrências."
                rows={3}
                disabled={isFinalized}
              />
            )}

            {section.key === "guidance" && (
              <FreeTextField
                label="Orientações ao paciente"
                description="Cuidados após procedimento, higiene, alimentação, retorno e recomendações."
                value={guidance}
                onChange={setGuidance}
                placeholder="Ex.: Orientado a evitar alimentos muito duros nas primeiras 24 horas."
                rows={3}
                disabled={isFinalized}
              />
            )}

            {section.key === "intercurrent" && (
              <IntercurrentToggle
                hasIntercurrent={intercurrentHas}
                description={intercurrentDesc}
                onHasIntercurrentChange={setIntercurrentHas}
                onDescriptionChange={setIntercurrentDesc}
                disabled={isFinalized}
              />
            )}

            {section.key === "observations" && (
              <FreeTextField
                label="Observações adicionais"
                description="Informações complementares relevantes para este atendimento."
                value={observations}
                onChange={setObservations}
                placeholder="Informações adicionais que não se encaixam nos campos estruturados."
                rows={3}
                disabled={isFinalized}
              />
            )}
          </EvolutionSectionCard>
        ))}
      </div>

      {/* Ações */}
      <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={responsibleName}
            onChange={(e) => setResponsibleName(e.target.value)}
            placeholder="Nome do profissional responsável"
            className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            disabled={isFinalized}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleSave}
            disabled={isSaving || isFinalized}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Salvar rascunho
              </>
            )}
          </Button>

          {!isFinalized && (
            <Button
              type="button"
              onClick={() => setShowFinalizeConfirm(true)}
              disabled={isFinalizing}
            >
              {isFinalizing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Finalizando...
                </>
              ) : (
                <>
                  <FileCheck className="mr-2 h-4 w-4" />
                  Finalizar atendimento
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Modal de confirmação de finalização */}
      {showFinalizeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Finalizar atendimento?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Após a finalização, alterações clínicas importantes poderão
              exigir registro de correção/auditoria. Deseja continuar?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowFinalizeConfirm(false)}
                disabled={isFinalizing}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  handleFinalize()
                  setShowFinalizeConfirm(false)
                }}
                disabled={isFinalizing || !responsibleName.trim()}
              >
                {isFinalizing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Finalizando...
                  </>
                ) : (
                  "Finalizar"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

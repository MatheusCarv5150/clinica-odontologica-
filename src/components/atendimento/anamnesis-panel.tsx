"use client"

import { useCallback, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertTriangle,
  Check,
  ClipboardList,
  HeartPulse,
  History,
  Loader2,
  Pill,
  ShieldAlert,
  Stethoscope,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAsyncData } from "@/lib/use-async-data"
import {
  ANXIETY_LEVEL_OPTIONS,
  COMPLAINT_INTENSITY_OPTIONS,
  CONDITION_OPTIONS,
  DENTAL_HISTORY_QUESTIONS,
  MEDICAL_HISTORY_QUESTIONS,
  formatAnamnesisDateTime,
  formatResponsible,
  type AnswerValue,
} from "@/lib/anamnesis-domain"
import { AnamnesisHistoryDrawer } from "./anamnesis-history-drawer"
import {
  AnamnesisSectionCard,
  AnamnesisEmptyState,
  AnamnesisSkeleton,
  AnswerControl,
  ClinicalAlertsPanel,
  FieldLabel,
  QuestionRow,
  textAreaClass,
  textInputClass,
} from "./anamnesis-ui"

// ===========================================================================
// ANAMNESE — Parte 4.
//
// Prontuário clínico vivo do paciente, separando:
// - PERFIL CLÍNICO (permanente, versionado): histórico médico, condições,
//   alergias, medicamentos, cirurgias, hábitos, histórico odontológico.
// - ATENDIMENTO ATUAL: queixa principal, ansiedade relatada e observações.
//
// Nenhum diagnóstico é gerado. "Não informado" nunca é tratado como "não".
// ===========================================================================

interface AnswerView {
  questionKey: string
  section: string
  label: string
  value: AnswerValue
  note: string | null
}

interface ItemView {
  id: string
  type: string
  itemKey: string | null
  label: string
  reaction: string | null
  dosage: string | null
  frequency: string | null
  purpose: string | null
  year: string | null
  reason: string | null
  active: boolean
  note: string | null
}

export interface AnamnesisApiResponse {
  patient: { id: string; fullName: string }
  attendance: { id: string; code: string }
  clinical: {
    recordId: string | null
    version: number | null
    updatedAt: string | null
    updatedByName: string | null
    answers: AnswerView[]
    conditions: ItemView[]
    allergies: ItemView[]
    medications: ItemView[]
    surgeries: ItemView[]
    notes: string | null
  }
  session: {
    id: string | null
    chiefComplaint: string | null
    visitReason: string | null
    complaintHistory: string | null
    complaintOnset: string | null
    complaintDuration: string | null
    complaintIntensity: string | null
    associatedSymptoms: string | null
    complaintNotes: string | null
    habitsNotes: string | null
    dentalNotes: string | null
    anxietyLevel: string | null
    anxietyNotes: string | null
    notes: string | null
    sessionAnswers: AnswerView[]
    updatedAt: string | null
    updatedByName: string | null
  }
  alerts: Array<{
    kind: "allergy" | "condition" | "medication" | "answer"
    text: string
    detail?: string | null
  }>
  hasAnyData: boolean
}

type ItemType = "condition" | "allergy" | "medication" | "surgery"

interface ItemDraft {
  type: ItemType
  itemKey: string | null
  label: string
  reaction: string
  dosage: string
  frequency: string
  purpose: string
  year: string
  reason: string
  active: boolean
  note: string
}

type AnswerDraft = Record<string, { value: AnswerValue | ""; note: string }>

interface SessionDraft {
  chiefComplaint: string
  visitReason: string
  complaintHistory: string
  complaintOnset: string
  complaintDuration: string
  complaintIntensity: string
  associatedSymptoms: string
  complaintNotes: string
  anxietyLevel: string
  anxietyNotes: string
  notes: string
}

const EMPTY_SESSION_DRAFT: SessionDraft = {
  chiefComplaint: "",
  visitReason: "",
  complaintHistory: "",
  complaintOnset: "",
  complaintDuration: "",
  complaintIntensity: "",
  associatedSymptoms: "",
  complaintNotes: "",
  anxietyLevel: "",
  anxietyNotes: "",
  notes: "",
}

function emptyItem(type: ItemType, itemKey: string | null = null, label = ""): ItemDraft {
  return {
    type,
    itemKey,
    label,
    reaction: "",
    dosage: "",
    frequency: "",
    purpose: "",
    year: "",
    reason: "",
    active: true,
    note: "",
  }
}

function toDraft(item: ItemView): ItemDraft {
  return {
    type: item.type as ItemType,
    itemKey: item.itemKey,
    label: item.label,
    reaction: item.reaction ?? "",
    dosage: item.dosage ?? "",
    frequency: item.frequency ?? "",
    purpose: item.purpose ?? "",
    year: item.year ?? "",
    reason: item.reason ?? "",
    active: item.active,
    note: item.note ?? "",
  }
}

interface AnamnesisPanelProps {
  attendanceId: string
  onSaved?: () => void
}

export function AnamnesisPanel({ attendanceId, onSaved }: AnamnesisPanelProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(["chief"])
  )

  const [answers, setAnswers] = useState<AnswerDraft>({})
  const [conditions, setConditions] = useState<ItemDraft[]>([])
  const [allergies, setAllergies] = useState<ItemDraft[]>([])
  const [medications, setMedications] = useState<ItemDraft[]>([])
  const [surgeries, setSurgeries] = useState<ItemDraft[]>([])
  const [clinicalNotes, setClinicalNotes] = useState("")
  const [session, setSession] = useState<SessionDraft>(EMPTY_SESSION_DRAFT)
  const [responsibleName, setResponsibleName] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)

  // -------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------

  const hydrate = useCallback((payload: AnamnesisApiResponse) => {
    const answerDraft: AnswerDraft = {}
    for (const a of payload.clinical.answers) {
      answerDraft[a.questionKey] = { value: a.value, note: a.note ?? "" }
    }
    setAnswers(answerDraft)
    setConditions(payload.clinical.conditions.map(toDraft))
    setAllergies(payload.clinical.allergies.map(toDraft))
    setMedications(payload.clinical.medications.map(toDraft))
    setSurgeries(payload.clinical.surgeries.map(toDraft))
    setClinicalNotes(payload.clinical.notes ?? "")
    setSession({
      chiefComplaint: payload.session.chiefComplaint ?? "",
      visitReason: payload.session.visitReason ?? "",
      complaintHistory: payload.session.complaintHistory ?? "",
      complaintOnset: payload.session.complaintOnset ?? "",
      complaintDuration: payload.session.complaintDuration ?? "",
      complaintIntensity: payload.session.complaintIntensity ?? "",
      associatedSymptoms: payload.session.associatedSymptoms ?? "",
      complaintNotes: payload.session.complaintNotes ?? "",
      anxietyLevel: payload.session.anxietyLevel ?? "",
      anxietyNotes: payload.session.anxietyNotes ?? "",
      notes: payload.session.notes ?? "",
    })
    setIsDirty(false)
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/attendance/${attendanceId}/anamnesis`, {
      cache: "no-store",
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || "Não foi possível carregar a anamnese.")
    }
    return (await res.json()) as AnamnesisApiResponse
  }, [attendanceId])

  const {
    data,
    isLoading,
    error: loadError,
    reload,
  } = useAsyncData<AnamnesisApiResponse>(load, [attendanceId])

  // Sincroniza o formulário quando chega um payload novo. Usa o padrão oficial
  // de "ajustar estado durante a renderização": guarda a referência já
  // aplicada e recalcula no mesmo render, sem efeito e sem render extra.
  const [hydratedFrom, setHydratedFrom] = useState<AnamnesisApiResponse | null>(
    null
  )

  if (data && data !== hydratedFrom) {
    setHydratedFrom(data)
    hydrate(data)
  }

  function touch() {
    setIsDirty(true)
    setSavedAt(null)
    setSaveError("")
  }

  function toggleSection(id: string) {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setSessionField<K extends keyof SessionDraft>(key: K, value: SessionDraft[K]) {
    setSession((s) => ({ ...s, [key]: value }))
    touch()
  }

  function setAnswer(questionKey: string, value: AnswerValue) {
    setAnswers((prev) => ({
      ...prev,
      [questionKey]: { value, note: prev[questionKey]?.note ?? "" },
    }))
    touch()
  }

  function setAnswerNote(questionKey: string, note: string) {
    setAnswers((prev) => ({
      ...prev,
      [questionKey]: { value: prev[questionKey]?.value ?? "", note },
    }))
    touch()
  }

  function updateItem(
    setter: React.Dispatch<React.SetStateAction<ItemDraft[]>>,
    index: number,
    patch: Partial<ItemDraft>
  ) {
    setter((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
    touch()
  }

  function removeItem(
    setter: React.Dispatch<React.SetStateAction<ItemDraft[]>>,
    index: number
  ) {
    setter((prev) => prev.filter((_, i) => i !== index))
    touch()
  }

  const hasChiefComplaint = session.chiefComplaint.trim().length > 0
  const showEmptyState = !isLoading && !!data && !data.hasAnyData && !isDirty

  const sectionSummaries = useMemo(() => {
    const answered = Object.values(answers).filter((a) => a.value !== "").length
    return {
      medical:
        answered > 0
          ? `${answered} resposta(s) registrada(s)`
          : "Nenhuma resposta registrada",
      conditions:
        conditions.length > 0
          ? `${conditions.length} condição(ões) registrada(s)`
          : "Nenhuma condição registrada",
      allergies:
        allergies.length > 0
          ? `${allergies.length} alergia(s) registrada(s)`
          : "Nenhuma alergia registrada",
      medications:
        medications.length > 0
          ? `${medications.length} medicamento(s)`
          : "Nenhum medicamento registrado",
      surgeries:
        surgeries.length > 0
          ? `${surgeries.length} registro(s)`
          : "Nenhuma cirurgia ou hospitalização registrada",
    }
  }, [answers, conditions, allergies, medications, surgeries])

  function buildAnswersPayload() {
    return Object.entries(answers)
      .filter(([, a]) => a.value !== "")
      .map(([questionKey, a]) => ({
        questionKey,
        section: MEDICAL_HISTORY_QUESTIONS.some((q) => q.key === questionKey)
          ? "medical_history"
          : questionKey.startsWith("habits.")
            ? "habits"
            : "dental_history",
        value: a.value as AnswerValue,
        note: a.note,
      }))
  }

  async function handleSave() {
    setIsSaving(true)
    setSaveError("")
    try {
      const payload = {
        responsibleName: responsibleName.trim() || null,
        clinical: {
          answers: buildAnswersPayload(),
          conditions: conditions.filter((c) => c.label.trim().length > 0),
          allergies: allergies.filter((a) => a.label.trim().length > 0),
          medications: medications.filter((m) => m.label.trim().length > 0),
          surgeries: surgeries.filter((s) => s.label.trim().length > 0),
          notes: clinicalNotes,
        },
        session: {
          ...session,
          complaintIntensity: session.complaintIntensity || null,
          anxietyLevel: session.anxietyLevel || null,
          sessionAnswers: [],
        },
      }

      const res = await fetch(`/api/attendance/${attendanceId}/anamnesis`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const details = Array.isArray(err.details)
          ? ` (${err.details.map((d: { message: string }) => d.message).join("; ")})`
          : ""
        setSaveError(`${err.error || "Não foi possível salvar a anamnese."}${details}`)
        return
      }

      const result = await res.json()
      setSavedAt(result.savedAt ?? new Date().toISOString())
      setIsDirty(false)
      await reload()
      onSaved?.()
    } catch {
      setSaveError("Erro de conexão. Tente novamente.")
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) return <AnamnesisSkeleton />

  if (loadError || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-400" />
        <p className="mt-2 text-sm font-medium text-red-800">
          {loadError || "Anamnese indisponível."}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Cabeçalho da área */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Anamnese</h2>
          <p className="text-sm text-gray-500">
            Avaliação clínica e informações do paciente
          </p>
          {data.clinical.version !== null && (
            <p className="mt-1 text-[11px] text-gray-400">
              Perfil clínico — versão {data.clinical.version} • atualizado em{" "}
              {formatAnamnesisDateTime(data.clinical.updatedAt)} por{" "}
              {formatResponsible(data.clinical.updatedByName)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
            <History className="h-3.5 w-3.5" />
            Ver histórico
          </Button>

          {isDirty && (
            <Badge className="gap-1.5 bg-amber-100 text-amber-800">
              <AlertTriangle className="h-3 w-3" />
              Alterações não salvas
            </Badge>
          )}

          {!isDirty && savedAt && (
            <Badge className="gap-1.5 bg-green-100 text-green-800">
              <Check className="h-3 w-3" />
              Salvo
            </Badge>
          )}
        </div>
      </div>

      {/* Responsável pela alteração */}
      <div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
        <FieldLabel htmlFor="anamnesis-responsible" hint="registrado na auditoria">
          Responsável pela alteração
        </FieldLabel>
        <input
          id="anamnesis-responsible"
          type="text"
          value={responsibleName}
          onChange={(e) => setResponsibleName(e.target.value)}
          placeholder="Nome do profissional que está registrando"
          className={textInputClass}
        />
      </div>

      {/* Alertas clínicos */}
      <ClinicalAlertsPanel alerts={data.alerts} />

      {showEmptyState && <AnamnesisEmptyState onStart={() => setIsDirty(true)} />}

      {/* QUEIXA PRINCIPAL — atendimento atual */}
      <AnamnesisSectionCard
        id="chief"
        title="Queixa principal"
        description="Informações deste atendimento"
        icon={<Stethoscope className="h-4 w-4" />}
        isOpen={openSections.has("chief")}
        onToggle={toggleSection}
        summary={
          hasChiefComplaint ? (
            <span className="line-clamp-1">{session.chiefComplaint}</span>
          ) : (
            "Nenhuma queixa registrada neste atendimento"
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FieldLabel htmlFor="chief-complaint">Queixa principal</FieldLabel>
            <input
              id="chief-complaint"
              type="text"
              value={session.chiefComplaint}
              onChange={(e) => setSessionField("chiefComplaint", e.target.value)}
              placeholder="Ex.: Paciente relata dor no dente 26."
              className={textInputClass}
            />
          </div>

          <div className="sm:col-span-2">
            <FieldLabel htmlFor="complaint-history">História da queixa</FieldLabel>
            <textarea
              id="complaint-history"
              rows={3}
              value={session.complaintHistory}
              onChange={(e) => setSessionField("complaintHistory", e.target.value)}
              placeholder="Ex.: Refere início há aproximadamente 3 dias, com piora durante mastigação."
              className={textAreaClass}
            />
          </div>

          <div>
            <FieldLabel htmlFor="visit-reason">Motivo da consulta</FieldLabel>
            <input
              id="visit-reason"
              type="text"
              value={session.visitReason}
              onChange={(e) => setSessionField("visitReason", e.target.value)}
              className={textInputClass}
            />
          </div>

          <div>
            <FieldLabel htmlFor="complaint-onset">Início dos sintomas</FieldLabel>
            <input
              id="complaint-onset"
              type="text"
              value={session.complaintOnset}
              onChange={(e) => setSessionField("complaintOnset", e.target.value)}
              placeholder="Ex.: há 3 dias"
              className={textInputClass}
            />
          </div>

          <div>
            <FieldLabel htmlFor="complaint-duration">Duração</FieldLabel>
            <input
              id="complaint-duration"
              type="text"
              value={session.complaintDuration}
              onChange={(e) => setSessionField("complaintDuration", e.target.value)}
              placeholder="Ex.: 3 dias"
              className={textInputClass}
            />
          </div>

          <div>
            <FieldLabel htmlFor="complaint-intensity" hint="quando aplicável">
              Intensidade
            </FieldLabel>
            <select
              id="complaint-intensity"
              value={session.complaintIntensity}
              onChange={(e) => setSessionField("complaintIntensity", e.target.value)}
              className={textInputClass}
            >
              <option value="">Não informada</option>
              {COMPLAINT_INTENSITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <FieldLabel htmlFor="associated-symptoms">Sintomas associados</FieldLabel>
            <input
              id="associated-symptoms"
              type="text"
              value={session.associatedSymptoms}
              onChange={(e) => setSessionField("associatedSymptoms", e.target.value)}
              className={textInputClass}
            />
          </div>

          <div className="sm:col-span-2">
            <FieldLabel htmlFor="complaint-notes">Observações</FieldLabel>
            <textarea
              id="complaint-notes"
              rows={2}
              value={session.complaintNotes}
              onChange={(e) => setSessionField("complaintNotes", e.target.value)}
              className={textAreaClass}
            />
          </div>
        </div>
      </AnamnesisSectionCard>

      {/* MEDO / ANSIEDADE */}
      <AnamnesisSectionCard
        id="anxiety"
        title="Medo / ansiedade odontológica"
        description="Informação relatada, usada para conduzir o atendimento"
        icon={<HeartPulse className="h-4 w-4" />}
        isOpen={openSections.has("anxiety")}
        onToggle={toggleSection}
        summary={
          session.anxietyLevel
            ? (ANXIETY_LEVEL_OPTIONS.find((o) => o.value === session.anxietyLevel)
                ?.label ?? "Registrado")
            : "Não informado"
        }
      >
        <div className="space-y-3">
          <div>
            <FieldLabel>Nível relatado</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {ANXIETY_LEVEL_OPTIONS.map((option) => {
                const selected = session.anxietyLevel === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      setSessionField("anxietyLevel", selected ? "" : option.value)
                    }
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                      selected
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100"
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="anxiety-notes" hint="ex.: experiência negativa anterior">
              Observações
            </FieldLabel>
            <textarea
              id="anxiety-notes"
              rows={2}
              value={session.anxietyNotes}
              onChange={(e) => setSessionField("anxietyNotes", e.target.value)}
              className={textAreaClass}
            />
          </div>
        </div>
      </AnamnesisSectionCard>

      {/* HISTÓRICO MÉDICO — perfil clínico */}
      <AnamnesisSectionCard
        id="medical"
        title="Histórico médico"
        description="Perguntas estruturadas — dado permanente do paciente"
        icon={<ClipboardList className="h-4 w-4" />}
        isOpen={openSections.has("medical")}
        onToggle={toggleSection}
        summary={sectionSummaries.medical}
      >
        <p className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
          &quot;Não sabe / Não informado&quot; é diferente de &quot;Não&quot;. Registre
          exatamente o que foi informado.
        </p>
        <div className="space-y-3">
          {MEDICAL_HISTORY_QUESTIONS.map((question) => (
            <QuestionRow
              key={question.key}
              question={question}
              draft={answers[question.key]}
              onAnswer={setAnswer}
              onNote={setAnswerNote}
            />
          ))}
        </div>
      </AnamnesisSectionCard>

      {/* DOENÇAS E CONDIÇÕES */}
      <AnamnesisSectionCard
        id="conditions"
        title="Doenças e condições"
        description="Registro estruturado e extensível"
        icon={<ShieldAlert className="h-4 w-4" />}
        isOpen={openSections.has("conditions")}
        onToggle={toggleSection}
        summary={sectionSummaries.conditions}
      >
        <div className="space-y-3">
          <div>
            <FieldLabel>Condições registradas</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {CONDITION_OPTIONS.map((option) => {
                const selected = conditions.some((c) => c.itemKey === option.key)
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      if (selected) {
                        setConditions((prev) =>
                          prev.filter((c) => c.itemKey !== option.key)
                        )
                        touch()
                      } else {
                        setConditions((prev) => [
                          ...prev,
                          emptyItem("condition", option.key, option.label),
                        ])
                        touch()
                      }
                    }}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                      selected
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100"
                    )}
                  >
                    {selected ? "✓ " : ""}
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <FieldLabel>Outras condições</FieldLabel>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConditions((prev) => [...prev, emptyItem("condition")])
                  touch()
                }}
              >
                + Adicionar
              </Button>
            </div>

            {conditions.filter((c) => c.itemKey === null).length === 0 ? (
              <p className="text-xs text-gray-400">
                Nenhuma condição adicional informada.
              </p>
            ) : (
              <ul className="space-y-2">
                {conditions.map((condition, index) =>
                  condition.itemKey === null ? (
                    <li key={`custom-condition-${index}`} className="flex items-start gap-2">
                      <input
                        type="text"
                        value={condition.label}
                        onChange={(e) =>
                          updateItem(setConditions, index, { label: e.target.value })
                        }
                        placeholder="Descreva a condição informada"
                        className={textInputClass}
                      />
                      <button
                        type="button"
                        onClick={() => removeItem(setConditions, index)}
                        className="mt-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                        aria-label="Remover condição"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ) : null
                )}
              </ul>
            )}
          </div>
        </div>
      </AnamnesisSectionCard>

      {/* ALERGIAS — alta prioridade */}
      <AnamnesisSectionCard
        id="allergies"
        title="Alergias"
        description="Alimenta automaticamente o resumo de alertas clínicos"
        icon={<AlertTriangle className="h-4 w-4" />}
        tone="critical"
        isOpen={openSections.has("allergies")}
        onToggle={toggleSection}
        summary={sectionSummaries.allergies}
      >
        <div className="space-y-3">
          <div>
            <FieldLabel>Possui alergia?</FieldLabel>
            <AnswerControl
              name="Possui alergia?"
              value={allergies.length > 0 ? "yes" : "unknown"}
              onChange={(value) => {
                if (value === "no" || value === "unknown") {
                  setAllergies([])
                  touch()
                } else if (allergies.length === 0) {
                  setAllergies([emptyItem("allergy")])
                  touch()
                }
              }}
            />
            <p className="mt-1 text-[11px] text-gray-400">
              &quot;Não&quot; e &quot;Não informado&quot; são registros distintos.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <FieldLabel>Alergias registradas</FieldLabel>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAllergies((prev) => [...prev, emptyItem("allergy")])
                touch()
              }}
            >
              + Adicionar alergia
            </Button>
          </div>

          {allergies.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
              Nenhuma alergia registrada.
            </p>
          ) : (
            <ul className="space-y-3">
              {allergies.map((allergy, index) => (
                <li
                  key={`allergy-${index}`}
                  className="rounded-lg border border-red-100 bg-red-50/40 p-3"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <FieldLabel>Substância / medicamento</FieldLabel>
                      <input
                        type="text"
                        value={allergy.label}
                        onChange={(e) =>
                          updateItem(setAllergies, index, { label: e.target.value })
                        }
                        placeholder="Ex.: Penicilina"
                        className={textInputClass}
                      />
                    </div>
                    <div>
                      <FieldLabel>Reação</FieldLabel>
                      <input
                        type="text"
                        value={allergy.reaction}
                        onChange={(e) =>
                          updateItem(setAllergies, index, { reaction: e.target.value })
                        }
                        placeholder="Ex.: Erupção cutânea"
                        className={textInputClass}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <FieldLabel>Observação</FieldLabel>
                      <input
                        type="text"
                        value={allergy.note}
                        onChange={(e) =>
                          updateItem(setAllergies, index, { note: e.target.value })
                        }
                        className={textInputClass}
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeItem(setAllergies, index)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                    >
                      <X className="h-3 w-3" />
                      Remover
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AnamnesisSectionCard>

      {/* MEDICAMENTOS */}
      <AnamnesisSectionCard
        id="medications"
        title="Medicamentos de uso contínuo"
        description="Nome, dosagem, frequência e finalidade (se informada)"
        icon={<Pill className="h-4 w-4" />}
        isOpen={openSections.has("medications")}
        onToggle={toggleSection}
        summary={sectionSummaries.medications}
      >
        <MedicationList
          medications={medications}
          onAdd={() => {
            setMedications((prev) => [...prev, emptyItem("medication")])
            touch()
          }}
          onChange={(index, patch) => updateItem(setMedications, index, patch)}
          onRemove={(index) => removeItem(setMedications, index)}
        />
      </AnamnesisSectionCard>

      {/* CIRURGIAS / HOSPITALIZAÇÕES */}
      <AnamnesisSectionCard
        id="surgeries"
        title="Cirurgias e hospitalizações"
        description="Data não é obrigatória quando o paciente não souber"
        icon={<ClipboardList className="h-4 w-4" />}
        isOpen={openSections.has("surgeries")}
        onToggle={toggleSection}
        summary={sectionSummaries.surgeries}
      >
        <SurgeryList
          surgeries={surgeries}
          onAdd={() => {
            setSurgeries((prev) => [...prev, emptyItem("surgery")])
            touch()
          }}
          onChange={(index, patch) => updateItem(setSurgeries, index, patch)}
          onRemove={(index) => removeItem(setSurgeries, index)}
        />
      </AnamnesisSectionCard>

      {/* HISTÓRICO ODONTOLÓGICO */}
      <AnamnesisSectionCard
        id="dental"
        title="Histórico odontológico"
        description="Informações clínicas declaradas (não duplica procedimentos)"
        icon={<Stethoscope className="h-4 w-4" />}
        isOpen={openSections.has("dental")}
        onToggle={toggleSection}
        summary="Informações declaradas pelo paciente nesta anamnese"
      >
        <p className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
          Este bloco registra o que o paciente RELATA. Os procedimentos realizados
          continuam disponíveis no Histórico de atendimentos.
        </p>
        <div className="space-y-3">
          {DENTAL_HISTORY_QUESTIONS.map((question) => (
            <QuestionRow
              key={question.key}
              question={question}
              draft={answers[question.key]}
              onAnswer={setAnswer}
              onNote={setAnswerNote}
            />
          ))}
        </div>
      </AnamnesisSectionCard>

      {/* OBSERVAÇÕES ADICIONAIS (perfil clínico) */}
      <AnamnesisSectionCard
        id="clinical-notes"
        title="Observações adicionais"
        description="Informações que não se encaixam nos campos estruturados"
        icon={<ClipboardList className="h-4 w-4" />}
        isOpen={openSections.has("clinical-notes")}
        onToggle={toggleSection}
        summary={
          clinicalNotes.trim()
            ? `${clinicalNotes.trim().slice(0, 80)}${clinicalNotes.trim().length > 80 ? "…" : ""}`
            : "Nenhuma observação registrada"
        }
      >
        <textarea
          rows={4}
          value={clinicalNotes}
          onChange={(e) => {
            setClinicalNotes(e.target.value)
            touch()
          }}
          placeholder="Observações do perfil clínico do paciente..."
          className={textAreaClass}
        />
      </AnamnesisSectionCard>

      {/* Barra de salvamento */}
      <div className="sticky bottom-4 flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3.5 shadow-md sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {saveError ? (
            <p className="truncate text-xs font-medium text-red-600">{saveError}</p>
          ) : isDirty ? (
            <p className="text-xs font-medium text-amber-700">
              Há alterações não salvas.
            </p>
          ) : savedAt ? (
            <p className="text-xs font-medium text-green-700">
              Anamnese salva em {formatAnamnesisDateTime(savedAt)}.
            </p>
          ) : (
            <p className="text-[11px] text-gray-500">
              As alterações são versionadas e ficam disponíveis no histórico.
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={isSaving}
          >
            Cancelar edição
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving || !isDirty}>
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar anamnese"
            )}
          </Button>
        </div>
      </div>

      {historyOpen && (
        <AnamnesisHistoryDrawer
          attendanceId={attendanceId}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Medicamentos
// ---------------------------------------------------------------------------

function MedicationList({
  medications,
  onAdd,
  onChange,
  onRemove,
}: {
  medications: ItemDraft[]
  onAdd: () => void
  onChange: (index: number, patch: Partial<ItemDraft>) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <FieldLabel>Medicamentos registrados</FieldLabel>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          + Adicionar medicamento
        </Button>
      </div>

      {medications.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
          Nenhum medicamento de uso contínuo registrado.
        </p>
      ) : (
        <ul className="space-y-3">
          {medications.map((medication, index) => (
            <li
              key={`medication-${index}`}
              className="rounded-lg border border-gray-200 bg-gray-50/60 p-3"
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <FieldLabel>Nome</FieldLabel>
                  <input
                    type="text"
                    value={medication.label}
                    onChange={(e) => onChange(index, { label: e.target.value })}
                    placeholder="Ex.: Losartana"
                    className={textInputClass}
                  />
                </div>
                <div>
                  <FieldLabel>Dosagem</FieldLabel>
                  <input
                    type="text"
                    value={medication.dosage}
                    onChange={(e) => onChange(index, { dosage: e.target.value })}
                    placeholder="Ex.: 50 mg"
                    className={textInputClass}
                  />
                </div>
                <div>
                  <FieldLabel>Frequência</FieldLabel>
                  <input
                    type="text"
                    value={medication.frequency}
                    onChange={(e) => onChange(index, { frequency: e.target.value })}
                    placeholder="Ex.: 1x ao dia"
                    className={textInputClass}
                  />
                </div>
                <div>
                  <FieldLabel hint="somente se informada">Finalidade</FieldLabel>
                  <input
                    type="text"
                    value={medication.purpose}
                    onChange={(e) => onChange(index, { purpose: e.target.value })}
                    className={textInputClass}
                  />
                </div>
                <div>
                  <FieldLabel>Situação</FieldLabel>
                  <select
                    value={medication.active ? "active" : "inactive"}
                    onChange={(e) =>
                      onChange(index, { active: e.target.value === "active" })
                    }
                    className={textInputClass}
                  >
                    <option value="active">Em uso</option>
                    <option value="inactive">Não utiliza mais</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel>Observação</FieldLabel>
                  <input
                    type="text"
                    value={medication.note}
                    onChange={(e) => onChange(index, { note: e.target.value })}
                    className={textInputClass}
                  />
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                >
                  <X className="h-3 w-3" />
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cirurgias / hospitalizações
// ---------------------------------------------------------------------------

function SurgeryList({
  surgeries,
  onAdd,
  onChange,
  onRemove,
}: {
  surgeries: ItemDraft[]
  onAdd: () => void
  onChange: (index: number, patch: Partial<ItemDraft>) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <FieldLabel>Registros</FieldLabel>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          + Adicionar registro
        </Button>
      </div>

      {surgeries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
          Nenhuma cirurgia ou hospitalização informada.
        </p>
      ) : (
        <ul className="space-y-3">
          {surgeries.map((surgery, index) => (
            <li
              key={`surgery-${index}`}
              className="rounded-lg border border-gray-200 bg-gray-50/60 p-3"
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <FieldLabel>Procedimento / cirurgia</FieldLabel>
                  <input
                    type="text"
                    value={surgery.label}
                    onChange={(e) => onChange(index, { label: e.target.value })}
                    placeholder="Ex.: Apendicectomia"
                    className={textInputClass}
                  />
                </div>
                <div>
                  <FieldLabel hint="não obrigatório">Ano / data</FieldLabel>
                  <input
                    type="text"
                    value={surgery.year}
                    onChange={(e) => onChange(index, { year: e.target.value })}
                    placeholder="Ex.: 2019"
                    className={textInputClass}
                  />
                </div>
                <div>
                  <FieldLabel>Motivo</FieldLabel>
                  <input
                    type="text"
                    value={surgery.reason}
                    onChange={(e) => onChange(index, { reason: e.target.value })}
                    className={textInputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel>Observações</FieldLabel>
                  <input
                    type="text"
                    value={surgery.note}
                    onChange={(e) => onChange(index, { note: e.target.value })}
                    className={textInputClass}
                  />
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                >
                  <X className="h-3 w-3" />
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

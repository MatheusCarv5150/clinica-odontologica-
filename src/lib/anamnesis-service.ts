import { prisma } from "@/lib/prisma"
import {
  type AnswerValue,
  type ClinicalAlert,
  type ClinicalAlertSource,
  buildClinicalAlerts,
  getConditionLabel,
  getQuestionLabel,
} from "@/lib/anamnesis-domain"
import type {
  AnamnesisItemInput,
  ClinicalProfileInput,
  SessionAnamnesisInput,
} from "@/lib/schemas-anamnesis"

// ===========================================================================
// Serviço da ANAMNESE (Parte 4).
//
// Responsabilidades:
// - Resolver o paciente SEMPRE a partir do atendimento (nunca do cliente).
// - Versionar o perfil clínico: cada gravação cria uma NOVA versão; nada é
//   sobrescrito silenciosamente (append-only + trilha de alterações).
// - Manter os dados do atendimento atual isolados por Appointment.
// ===========================================================================

// ---------------------------------------------------------------------------
// Tipos do contrato com o frontend
// ---------------------------------------------------------------------------

export interface AnamnesisAnswerView {
  questionKey: string
  section: string
  label: string
  value: AnswerValue
  note: string | null
}

export interface AnamnesisItemView {
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

export interface ClinicalProfileView {
  recordId: string | null
  version: number | null
  updatedAt: string | null
  updatedByName: string | null
  answers: AnamnesisAnswerView[]
  conditions: AnamnesisItemView[]
  allergies: AnamnesisItemView[]
  medications: AnamnesisItemView[]
  surgeries: AnamnesisItemView[]
  notes: string | null
}

export interface SessionView {
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
  sessionAnswers: AnamnesisAnswerView[]
  updatedAt: string | null
  updatedByName: string | null
}

export interface AnamnesisResponse {
  patient: { id: string; fullName: string }
  attendance: { id: string; code: string }
  clinical: ClinicalProfileView
  session: SessionView
  alerts: ClinicalAlert[]
  hasAnyData: boolean
}

export interface AnamnesisHistoryEntry {
  id: string
  scope: "clinical" | "session"
  label: string
  field: string
  oldValue: string | null
  newValue: string | null
  changedAt: string
  changedByName: string | null
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

// Resolve o atendimento + paciente. Toda operação parte daqui, garantindo que
// o paciente nunca venha do cliente (isolamento entre pacientes).
export async function resolveAttendance(attendanceId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: attendanceId },
    select: {
      id: true,
      patientId: true,
      patient: { select: { id: true, fullName: true } },
    },
  })
  return appointment
}

function toItemView(item: {
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
}): AnamnesisItemView {
  return {
    id: item.id,
    type: item.type,
    itemKey: item.itemKey,
    label: item.label,
    reaction: item.reaction,
    dosage: item.dosage,
    frequency: item.frequency,
    purpose: item.purpose,
    year: item.year,
    reason: item.reason,
    active: item.active,
    note: item.note,
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const EMPTY_CLINICAL: ClinicalProfileView = {
  recordId: null,
  version: null,
  updatedAt: null,
  updatedByName: null,
  answers: [],
  conditions: [],
  allergies: [],
  medications: [],
  surgeries: [],
  notes: null,
}

const EMPTY_SESSION: SessionView = {
  id: null,
  chiefComplaint: null,
  visitReason: null,
  complaintHistory: null,
  complaintOnset: null,
  complaintDuration: null,
  complaintIntensity: null,
  associatedSymptoms: null,
  complaintNotes: null,
  habitsNotes: null,
  dentalNotes: null,
  anxietyLevel: null,
  anxietyNotes: null,
  notes: null,
  sessionAnswers: [],
  updatedAt: null,
  updatedByName: null,
}

// Carrega a versão vigente do perfil clínico do paciente (a mais recente).
async function loadCurrentRecord(patientId: string) {
  return prisma.anamnesisRecord.findFirst({
    where: { patientId, scope: "patient" },
    orderBy: { version: "desc" },
    include: {
      answers: { orderBy: { questionKey: "asc" } },
      items: { orderBy: [{ type: "asc" }, { position: "asc" }] },
    },
  })
}

export async function getAnamnesis(attendanceId: string): Promise<AnamnesisResponse | null> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) return null

  const [record, session] = await Promise.all([
    loadCurrentRecord(appointment.patientId),
    prisma.anamnesis.findUnique({
      where: { appointmentId: attendanceId },
      include: { sessionAnswers: { orderBy: { questionKey: "asc" } } },
    }),
  ])

  const clinical: ClinicalProfileView = record
    ? {
        recordId: record.id,
        version: record.version,
        updatedAt: record.createdAt.toISOString(),
        updatedByName: record.createdByName,
        answers: record.answers.map((a) => ({
          questionKey: a.questionKey,
          section: a.section,
          label: getQuestionLabel(a.questionKey),
          value: a.value as AnswerValue,
          note: a.note,
        })),
        conditions: record.items.filter((i) => i.type === "condition").map(toItemView),
        allergies: record.items.filter((i) => i.type === "allergy").map(toItemView),
        medications: record.items.filter((i) => i.type === "medication").map(toItemView),
        surgeries: record.items.filter((i) => i.type === "surgery").map(toItemView),
        notes: record.notes,
      }
    : EMPTY_CLINICAL

  const sessionView: SessionView = session
    ? {
        id: session.id,
        chiefComplaint: session.chiefComplaint,
        visitReason: session.visitReason,
        complaintHistory: session.complaintHistory,
        complaintOnset: session.complaintOnset,
        complaintDuration: session.complaintDuration,
        complaintIntensity: session.complaintIntensity,
        associatedSymptoms: session.associatedSymptoms,
        complaintNotes: session.complaintNotes,
        habitsNotes: session.habitsNotes,
        dentalNotes: session.dentalNotes,
        anxietyLevel: session.anxietyLevel,
        anxietyNotes: session.anxietyNotes,
        notes: session.notes,
        sessionAnswers: session.sessionAnswers.map((a) => ({
          questionKey: a.questionKey,
          section: a.section,
          label: getQuestionLabel(a.questionKey),
          value: a.value as AnswerValue,
          note: a.note,
        })),
        updatedAt: session.updatedAt.toISOString(),
        updatedByName: session.createdByName,
      }
    : EMPTY_SESSION

  const alertSource: ClinicalAlertSource = {
    conditions: clinical.conditions.map((c) => ({ label: c.label, note: c.note })),
    allergies: clinical.allergies.map((a) => ({
      label: a.label,
      reaction: a.reaction,
      note: a.note,
    })),
    medications: clinical.medications.map((m) => ({
      label: m.label,
      dosage: m.dosage,
      frequency: m.frequency,
      active: m.active,
    })),
    answers: clinical.answers.map((a) => ({
      questionKey: a.questionKey,
      value: a.value,
      note: a.note,
    })),
  }

  const hasAnyData =
    clinical.recordId !== null ||
    sessionView.id !== null ||
    clinical.answers.length > 0 ||
    clinical.conditions.length > 0 ||
    clinical.allergies.length > 0 ||
    clinical.medications.length > 0 ||
    clinical.surgeries.length > 0 ||
    !!clinical.notes

  return {
    patient: { id: appointment.patient.id, fullName: appointment.patient.fullName },
    attendance: { id: appointment.id, code: buildCode(appointment.id) },
    clinical,
    session: sessionView,
    alerts: buildClinicalAlerts(alertSource),
    hasAnyData,
  }
}

// ---------------------------------------------------------------------------
// Diferenças → trilha de auditoria
// ---------------------------------------------------------------------------

interface ChangeEntry {
  entity: "answer" | "item" | "notes"
  field: string
  label: string
  oldValue: string | null
  newValue: string | null
}

// Serializa um item para comparação estável (ordem fixa de campos).
function serializeItem(item: {
  label: string
  reaction: string | null
  dosage: string | null
  frequency: string | null
  purpose: string | null
  year: string | null
  reason: string | null
  active: boolean
  note: string | null
}): string {
  return [
    item.label,
    item.reaction ?? "",
    item.dosage ?? "",
    item.frequency ?? "",
    item.purpose ?? "",
    item.year ?? "",
    item.reason ?? "",
    item.active ? "ativo" : "inativo",
    item.note ?? "",
  ].join(" | ")
}

// Rótulo legível de um item conforme o tipo.
function itemLabel(type: string, item: { label: string; itemKey: string | null }): string {
  if (type === "allergy") return `Alergia: ${item.label}`
  if (type === "medication") return `Medicamento: ${item.label}`
  if (type === "surgery") return `Cirurgia: ${item.label}`
  if (item.itemKey) return getConditionLabel(item.itemKey) ?? item.label
  return `Condição: ${item.label}`
}

function answerToText(value: string, note: string | null): string {
  const base = value === "yes" ? "Sim" : value === "no" ? "Não" : "Não informado"
  return note ? `${base} — ${note}` : base
}

// Compara respostas (por questionKey) e gera entradas de alteração.
function diffAnswers(
  before: Array<{ questionKey: string; value: string; note: string | null }>,
  after: Array<{ questionKey: string; value: string; note: string | null }>
): ChangeEntry[] {
  const beforeMap = new Map(before.map((a) => [a.questionKey, a]))
  const afterMap = new Map(after.map((a) => [a.questionKey, a]))
  const entries: ChangeEntry[] = []

  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()])
  for (const key of keys) {
    const oldAnswer = beforeMap.get(key) ?? null
    const newAnswer = afterMap.get(key) ?? null
    const oldText = oldAnswer ? answerToText(oldAnswer.value, oldAnswer.note) : null
    const newText = newAnswer ? answerToText(newAnswer.value, newAnswer.note) : null
    if (oldText === newText) continue
    entries.push({
      entity: "answer",
      field: key,
      label: getQuestionLabel(key),
      oldValue: oldText,
      newValue: newText,
    })
  }

  return entries
}

// Compara itens por tipo + chave/rótulo e gera entradas de alteração.
function diffItems(
  before: Array<{
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
  }>,
  after: AnamnesisItemInput[]
): ChangeEntry[] {
  const keyOf = (item: { type: string; itemKey: string | null; label: string }) =>
    `${item.type}::${item.itemKey ?? item.label.toLowerCase()}`

  const beforeMap = new Map(before.map((i) => [keyOf(i), i]))
  const afterMap = new Map(after.map((i) => [keyOf(i), i]))
  const entries: ChangeEntry[] = []

  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()])
  for (const key of keys) {
    const oldItem = beforeMap.get(key) ?? null
    const newItem = afterMap.get(key) ?? null
    const oldText = oldItem ? serializeItem(oldItem) : null
    const newText = newItem ? serializeItem(newItem) : null
    if (oldText === newText) continue
    const reference = newItem ?? oldItem
    if (!reference) continue
    entries.push({
      entity: "item",
      field: reference.itemKey ?? reference.label,
      label: itemLabel(reference.type, reference),
      oldValue: oldText,
      newValue: newText,
    })
  }

  return entries
}

// ---------------------------------------------------------------------------
// Escrita — perfil clínico versionado
// ---------------------------------------------------------------------------

// Cria uma NOVA versão do perfil clínico. O registro anterior nunca é
// alterado: o histórico permanece íntegro para auditoria.
async function createClinicalVersion(
  patientId: string,
  clinical: ClinicalProfileInput,
  responsibleName: string | null
): Promise<{ recordId: string; changes: ChangeEntry[] }> {
  const previous = await prisma.anamnesisRecord.findFirst({
    where: { patientId, scope: "patient" },
    orderBy: { version: "desc" },
    include: { answers: true, items: true },
  })

  const nextVersion = (previous?.version ?? 0) + 1

  // Comparação feita ANTES da gravação, com os dados já normalizados.
  const normalizedAnswers = clinical.answers.map((a) => ({
    questionKey: a.questionKey,
    section: a.section,
    value: a.value as string,
    note: a.note ?? null,
  }))

  const allItems: AnamnesisItemInput[] = [
    ...clinical.conditions,
    ...clinical.allergies,
    ...clinical.medications,
    ...clinical.surgeries,
  ]

  const changes: ChangeEntry[] = [
    ...diffAnswers(
      previous?.answers.map((a) => ({
        questionKey: a.questionKey,
        value: a.value,
        note: a.note,
      })) ?? [],
      normalizedAnswers
    ),
    ...diffItems(previous?.items ?? [], allItems),
  ]

  const notesChanged = (previous?.notes ?? null) !== (clinical.notes ?? null)
  if (previous && notesChanged) {
    changes.push({
      entity: "notes",
      field: "notes",
      label: "Observações do perfil clínico",
      oldValue: previous.notes,
      newValue: clinical.notes,
    })
  }

  const record = await prisma.anamnesisRecord.create({
    data: {
      patientId,
      version: nextVersion,
      scope: "patient",
      notes: clinical.notes,
      createdByName: responsibleName,
      answers: {
        create: normalizedAnswers,
      },
      items: {
        create: allItems.map((item, index) => ({
          type: item.type,
          itemKey: item.itemKey,
          label: item.label,
          reaction: item.reaction,
          dosage: item.dosage,
          frequency: item.frequency,
          purpose: item.purpose,
          year: item.year,
          reason: item.reason,
          active: item.active,
          note: item.note,
          position: index,
        })),
      },
    },
    select: { id: true },
  })

  if (changes.length > 0) {
    await prisma.anamnesisChangeLog.createMany({
      data: changes.map((change) => ({
        recordId: record.id,
        patientId,
        entity: change.entity,
        field: change.field,
        label: change.label,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedByName: responsibleName,
      })),
    })
  }

  return { recordId: record.id, changes }
}

// ---------------------------------------------------------------------------
// Escrita — dados do atendimento atual
// ---------------------------------------------------------------------------

function emptySessionData() {
  return {
    chiefComplaint: null,
    visitReason: null,
    complaintHistory: null,
    complaintOnset: null,
    complaintDuration: null,
    complaintIntensity: null,
    associatedSymptoms: null,
    complaintNotes: null,
    habitsNotes: null,
    dentalNotes: null,
    anxietyLevel: null,
    anxietyNotes: null,
    notes: null,
  }
}

async function saveSession(
  appointmentId: string,
  patientId: string,
  clinicalRecordId: string | null,
  session: SessionAnamnesisInput,
  responsibleName: string | null
) {
  const data = {
    ...emptySessionData(),
    ...session,
    // O cliente nunca envia ids de relacionamento.
    sessionAnswers: undefined,
  }

  return prisma.anamnesis.upsert({
    where: { appointmentId },
    create: {
      appointmentId,
      patientId,
      clinicalRecordId,
      createdByName: responsibleName,
      ...data,
      sessionAnswers: {
        create: session.sessionAnswers.map((a) => ({
          questionKey: a.questionKey,
          section: a.section,
          value: a.value,
          note: a.note,
        })),
      },
    },
    update: {
      clinicalRecordId,
      ...data,
      sessionAnswers: {
        deleteMany: {},
        create: session.sessionAnswers.map((a) => ({
          questionKey: a.questionKey,
          section: a.section,
          value: a.value,
          note: a.note,
        })),
      },
    },
    select: { id: true },
  })
}

// ---------------------------------------------------------------------------
// API de alto nível
// ---------------------------------------------------------------------------

export interface SaveResult {
  clinicalVersion: number | null
  changes: number
  sessionId: string
}

// Salva a anamnese do atendimento. Resolve o paciente pelo atendimento;
// versiona o perfil clínico quando enviado; grava os dados do atendimento.
export async function saveAnamnesis(
  attendanceId: string,
  input: {
    clinical?: ClinicalProfileInput
    session: SessionAnamnesisInput
    responsibleName: string | null
  }
): Promise<SaveResult | null> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) return null

  let clinicalRecordId: string | null = null
  let clinicalVersion: number | null = null
  let changesCount = 0

  if (input.clinical) {
    const result = await createClinicalVersion(
      appointment.patientId,
      input.clinical,
      input.responsibleName
    )
    clinicalRecordId = result.recordId
    changesCount = result.changes.length
    const record = await prisma.anamnesisRecord.findUnique({
      where: { id: result.recordId },
      select: { version: true },
    })
    clinicalVersion = record?.version ?? null
  } else {
    // Reaproveita a versão vigente para manter o vínculo do atendimento.
    const current = await prisma.anamnesisRecord.findFirst({
      where: { patientId: appointment.patientId, scope: "patient" },
      orderBy: { version: "desc" },
      select: { id: true },
    })
    clinicalRecordId = current?.id ?? null
  }

  const session = await saveSession(
    appointment.id,
    appointment.patientId,
    clinicalRecordId,
    input.session,
    input.responsibleName
  )

  return {
    clinicalVersion,
    changes: changesCount,
    sessionId: session.id,
  }
}

// ---------------------------------------------------------------------------
// Histórico / auditoria
// ---------------------------------------------------------------------------

// Histórico de alterações do perfil clínico do paciente dono do atendimento.
export async function getAnamnesisHistory(
  attendanceId: string,
  limit = 100
): Promise<{ entries: AnamnesisHistoryEntry[]; hasAnyRecord: boolean } | null> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) return null

  const logs = await prisma.anamnesisChangeLog.findMany({
    where: { patientId: appointment.patientId },
    orderBy: { changedAt: "desc" },
    take: Math.min(300, Math.max(1, limit)),
    select: {
      id: true,
      field: true,
      label: true,
      oldValue: true,
      newValue: true,
      changedAt: true,
      changedByName: true,
    },
  })

  const recordCount = await prisma.anamnesisRecord.count({
    where: { patientId: appointment.patientId, scope: "patient" },
  })

  return {
    entries: logs.map((log) => ({
      id: log.id,
      scope: "clinical",
      field: log.field,
      label: log.label,
      oldValue: log.oldValue,
      newValue: log.newValue,
      changedAt: log.changedAt.toISOString(),
      changedByName: log.changedByName,
    })),
    hasAnyRecord: recordCount > 0,
  }
}

// ---------------------------------------------------------------------------
// Alertas do cabeçalho
// ---------------------------------------------------------------------------

// Alertas clínicos do paciente dono do atendimento. Usado pelo cabeçalho para
// exibir alergias/condições/medicamentos SEM exigir a abertura da anamnese.
export async function getClinicalAlertsForAttendance(
  attendanceId: string
): Promise<{ patientId: string; alerts: ClinicalAlert[] } | null> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) return null

  const record = await loadCurrentRecord(appointment.patientId)

  const source: ClinicalAlertSource = {
    conditions: record?.items
      .filter((i) => i.type === "condition")
      .map((i) => ({ label: i.label, note: i.note })) ?? [],
    allergies: record?.items
      .filter((i) => i.type === "allergy")
      .map((i) => ({ label: i.label, reaction: i.reaction, note: i.note })) ?? [],
    medications: record?.items
      .filter((i) => i.type === "medication")
      .map((i) => ({
        label: i.label,
        dosage: i.dosage,
        frequency: i.frequency,
        active: i.active,
      })) ?? [],
    answers:
      record?.answers.map((a) => ({
        questionKey: a.questionKey,
        value: a.value,
        note: a.note,
      })) ?? [],
  }

  return { patientId: appointment.patientId, alerts: buildClinicalAlerts(source) }
}

function buildCode(id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
  return compact.slice(-6).padStart(6, "0")
}

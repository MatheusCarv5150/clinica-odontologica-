// ===========================================================================
// Domínio compartilhado da ANAMNESE — módulo Atendimento (Parte 4).
// ===========================================================================
//
// Este arquivo é a "fonte da verdade" das perguntas, listas e regras de
// apresentação da anamnese. Backend e frontend leem daqui, evitando que cada
// lado recrie suas próprias tabelas e permitindo evoluir o questionário sem
// tocar nas telas.
//
// PRINCÍPIOS (obrigatórios):
// - O sistema NUNCA cria diagnósticos. Nada aqui interpreta respostas como
//   diagnóstico, infere doenças ou sugere condições. A camada apenas
//   transporta e apresenta o que foi registrado pelo profissional/paciente.
// - "Não informado" é um valor de primeira classe e NUNCA é tratado como
//   "não" — segurança clínica.
// - As listas de doenças/hábitos são checklists de APOIO, não campos rígidos
//   do banco: itens livres e novos itens são sempre suportados.

// ---------------------------------------------------------------------------
// Valores estruturados de resposta
// ---------------------------------------------------------------------------

// Resposta Sim / Não / Não informado.
export type AnswerValue = "yes" | "no" | "unknown"

export const ANSWER_VALUES: AnswerValue[] = ["yes", "no", "unknown"]

export const ANSWER_LABELS: Record<AnswerValue, string> = {
  yes: "Sim",
  no: "Não",
  unknown: "Não sabe / Não informado",
}

// Resposta curta para exibição compacta (histórico/alertas).
export const ANSWER_SHORT_LABELS: Record<AnswerValue, string> = {
  yes: "Sim",
  no: "Não",
  unknown: "Não informado",
}

export function isAnswerValue(value: unknown): value is AnswerValue {
  return value === "yes" || value === "no" || value === "unknown"
}

// ---------------------------------------------------------------------------
// Seções da anamnese
// ---------------------------------------------------------------------------

export type AnamnesisSection = "medical_history" | "habits" | "dental_history"

export interface AnamnesisQuestion {
  key: string
  section: AnamnesisSection
  label: string
  // Texto de apoio opcional (ajuda clínica, sem emitir diagnóstico).
  hint?: string
}

// Perguntas estruturadas da seção "Histórico médico".
export const MEDICAL_HISTORY_QUESTIONS: AnamnesisQuestion[] = [
  {
    key: "medical.has_condition",
    section: "medical_history",
    label: "Possui alguma doença ou condição de saúde?",
  },
  {
    key: "medical.cardiac",
    section: "medical_history",
    label: "Possui histórico de problemas cardíacos?",
  },
  {
    key: "medical.hypertension",
    section: "medical_history",
    label: "Possui hipertensão?",
  },
  {
    key: "medical.diabetes",
    section: "medical_history",
    label: "Possui diabetes?",
  },
  {
    key: "medical.coagulation",
    section: "medical_history",
    label: "Possui problemas de coagulação?",
  },
  {
    key: "medical.surgeries",
    section: "medical_history",
    label: "Já realizou cirurgias?",
  },
  {
    key: "medical.hospitalization",
    section: "medical_history",
    label: "Já foi hospitalizado?",
  },
  {
    key: "medical.ongoing_treatment",
    section: "medical_history",
    label: "Está realizando algum tratamento médico?",
  },
  {
    key: "medical.other_relevant",
    section: "medical_history",
    label: "Possui alguma condição que considere importante informar?",
  },
]

// Perguntas estruturadas da seção "Hábitos".
// Informações relevantes ao contexto odontológico. Nenhuma classificação
// automática ou juízo de valor é aplicado.
export const HABITS_QUESTIONS: AnamnesisQuestion[] = [
  {
    key: "habits.smoking",
    section: "habits",
    label: "Tabagismo",
  },
  {
    key: "habits.alcohol",
    section: "habits",
    label: "Consumo de álcool",
  },
  {
    key: "habits.bruxism",
    section: "habits",
    label: "Bruxismo",
  },
  {
    key: "habits.nail_biting",
    section: "habits",
    label: "Roer unhas",
  },
  {
    key: "habits.oral_hygiene",
    section: "habits",
    label: "Higiene oral satisfatória",
  },
  {
    key: "habits.prosthesis_use",
    section: "habits",
    label: "Uso de próteses",
  },
  {
    key: "habits.other",
    section: "habits",
    label: "Outros hábitos relevantes",
  },
]

// Perguntas estruturadas da seção "Histórico odontológico".
// Registra apenas informações DECLARADAS — o histórico de procedimentos
// executados continua vindo das entidades reais de atendimento (Appointment /
// AppointmentProcedure) e não é duplicado aqui.
export const DENTAL_HISTORY_QUESTIONS: AnamnesisQuestion[] = [
  {
    key: "dental.previous_treatment",
    section: "dental_history",
    label: "Já realizou tratamento odontológico anteriormente?",
  },
  {
    key: "dental.last_visit",
    section: "dental_history",
    label: "Realizou consulta odontológica nos últimos 6 meses?",
    hint: 'Use a observação para informar "quando foi a última consulta", se souber.',
  },
  {
    key: "dental.extractions",
    section: "dental_history",
    label: "Já teve extrações dentárias?",
  },
  {
    key: "dental.root_canal",
    section: "dental_history",
    label: "Já realizou tratamento de canal?",
  },
  {
    key: "dental.orthodontics",
    section: "dental_history",
    label: "Já utilizou aparelho ortodôntico?",
  },
  {
    key: "dental.prosthesis",
    section: "dental_history",
    label: "Possui prótese?",
  },
  {
    key: "dental.implants",
    section: "dental_history",
    label: "Possui implantes?",
  },
  {
    key: "dental.periodontal",
    section: "dental_history",
    label: "Já apresentou problemas periodontais?",
  },
  {
    key: "dental.pain_sensitivity",
    section: "dental_history",
    label: "Costuma sentir dor ou sensibilidade?",
  },
  {
    key: "dental.fear",
    section: "dental_history",
    label: "Possui medo ou ansiedade relacionada ao atendimento odontológico?",
  },
]

export const ALL_QUESTIONS: AnamnesisQuestion[] = [
  ...MEDICAL_HISTORY_QUESTIONS,
  ...HABITS_QUESTIONS,
  ...DENTAL_HISTORY_QUESTIONS,
]

export function getQuestion(key: string): AnamnesisQuestion | undefined {
  return ALL_QUESTIONS.find((q) => q.key === key)
}

export function getQuestionLabel(key: string): string {
  return getQuestion(key)?.label ?? key
}

export function getSectionQuestions(section: AnamnesisSection): AnamnesisQuestion[] {
  return ALL_QUESTIONS.filter((q) => q.section === section)
}

// ---------------------------------------------------------------------------
// Checklist de doenças / condições (extensível)
// ---------------------------------------------------------------------------
//
// O checklist é apenas um atalho de digitação. O dado persistido é o item
// estruturado (AnamnesisRecordItem), com "Outras" aceitando texto livre. Isso
// permite acrescentar novas condições sem migration nem mudança de tela.

export interface ConditionOption {
  key: string
  label: string
}

export const CONDITION_OPTIONS: ConditionOption[] = [
  { key: "diabetes", label: "Diabetes" },
  { key: "hipertensao", label: "Hipertensão" },
  { key: "doenca_cardiaca", label: "Doença cardíaca" },
  { key: "coagulacao", label: "Problemas de coagulação" },
  { key: "osteoporose", label: "Osteoporose" },
  { key: "doenca_renal", label: "Doença renal" },
  { key: "doenca_hepatica", label: "Doença hepática" },
  { key: "respiratoria", label: "Problemas respiratórios" },
  { key: "imunossupressao", label: "Imunossupressão" },
]

export const CONDITION_OTHER_KEY = "outras"

export function getConditionLabel(key: string): string | null {
  if (key === CONDITION_OTHER_KEY) return "Outras"
  return CONDITION_OPTIONS.find((c) => c.key === key)?.label ?? null
}

// ---------------------------------------------------------------------------
// Tipos de item do perfil clínico
// ---------------------------------------------------------------------------

export type AnamnesisItemType = "condition" | "allergy" | "medication" | "surgery"

export const ITEM_TYPE_LABELS: Record<AnamnesisItemType, string> = {
  condition: "Doença / condição",
  allergy: "Alergia",
  medication: "Medicamento",
  surgery: "Cirurgia / hospitalização",
}

// ---------------------------------------------------------------------------
// Intensidade da dor (queixa principal) — lista controlada, não diagnóstica
// ---------------------------------------------------------------------------

export type ComplaintIntensity = "none" | "mild" | "moderate" | "severe"

export const COMPLAINT_INTENSITY_OPTIONS: Array<{
  value: ComplaintIntensity
  label: string
}> = [
  { value: "none", label: "Sem dor" },
  { value: "mild", label: "Leve" },
  { value: "moderate", label: "Moderada" },
  { value: "severe", label: "Intensa" },
]

export function getComplaintIntensityLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return COMPLAINT_INTENSITY_OPTIONS.find((o) => o.value === value)?.label ?? null
}

// ---------------------------------------------------------------------------
// Medo / ansiedade odontológica — informação assistencial
// ---------------------------------------------------------------------------
//
// NÃO é diagnóstico psicológico. É apenas o relato que ajuda a conduzir o
// atendimento (ex.: necessidade de mais tempo, pausas, comunicação).

export type AnxietyLevel = "none" | "mild" | "moderate" | "severe"

export const ANXIETY_LEVEL_OPTIONS: Array<{ value: AnxietyLevel; label: string }> = [
  { value: "none", label: "Sem ansiedade relatada" },
  { value: "mild", label: "Ansiedade leve" },
  { value: "moderate", label: "Ansiedade moderada" },
  { value: "severe", label: "Ansiedade intensa" },
]

export function getAnxietyLevelLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return ANXIETY_LEVEL_OPTIONS.find((o) => o.value === value)?.label ?? null
}

// ---------------------------------------------------------------------------
// Alertas clínicos (apresentação)
// ---------------------------------------------------------------------------

export type ClinicalAlertKind = "allergy" | "condition" | "medication" | "answer"

export interface ClinicalAlert {
  kind: ClinicalAlertKind
  // Texto pronto para exibição (ex.: "Alergia: Penicilina").
  text: string
  // Detalhe complementar opcional (reação, dosagem, observação).
  detail?: string | null
}

// Palavras que, quando respondidas com "sim" ou registradas como condição,
// merecem destaque no resumo de alertas do cabeçalho. É apenas uma regra de
// APRESENTAÇÃO do dado registrado — não cria, infere nem sugere diagnósticos.
const CRITICAL_ANSWER_KEYS = new Set<string>([
  "medical.cardiac",
  "medical.hypertension",
  "medical.coagulation",
  "medical.diabetes",
  "dental.fear",
])

export interface ClinicalAlertSource {
  conditions: Array<{ label: string; note?: string | null }>
  allergies: Array<{ label: string; reaction?: string | null; note?: string | null }>
  medications: Array<{
    label: string
    dosage?: string | null
    frequency?: string | null
    active?: boolean
  }>
  answers: Array<{ questionKey: string; value: string; note?: string | null }>
}

export function buildClinicalAlerts(source: ClinicalAlertSource): ClinicalAlert[] {
  const alerts: ClinicalAlert[] = []

  for (const allergy of source.allergies) {
    alerts.push({
      kind: "allergy",
      text: `Alergia: ${allergy.label}`,
      detail: allergy.reaction || allergy.note || null,
    })
  }

  for (const condition of source.conditions) {
    alerts.push({
      kind: "condition",
      text: `Condição: ${condition.label}`,
      detail: condition.note || null,
    })
  }

  for (const medication of source.medications) {
    if (medication.active === false) continue
    const dosage = medication.dosage ? ` ${medication.dosage}` : ""
    const frequency = medication.frequency ? ` — ${medication.frequency}` : ""
    alerts.push({
      kind: "medication",
      text: `Medicamento: ${medication.label}${dosage}${frequency}`,
      detail: null,
    })
  }

  // Respostas "Sim" em perguntas de relevância clínica entram no resumo como
  // reforço do registro declarado.
  for (const answer of source.answers) {
    if (answer.value !== "yes") continue
    if (!CRITICAL_ANSWER_KEYS.has(answer.questionKey)) continue
    // Evita duplicar quando já existe uma condição equivalente registrada.
    const label = getQuestionLabel(answer.questionKey)
    if (alerts.some((a) => a.text.endsWith(label))) continue
    alerts.push({
      kind: "answer",
      text: label,
      detail: answer.note || null,
    })
  }

  return alerts
}

// ---------------------------------------------------------------------------
// Formatação (apresentação compartilhada)
// ---------------------------------------------------------------------------

// "10/09/2026" — data de um registro/atualização.
// As datas de negócio são gravadas com fuso do servidor; aqui usamos uma
// formatação determinística para evitar divergência entre SSR e CSR.
export function formatAnamnesisDate(value: Date | string | null | undefined): string {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return "—"
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${day}/${month}/${date.getFullYear()}`
}

// "10/09/2026 às 14:30" — momento completo de um registro/atualização.
export function formatAnamnesisDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—"
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return "—"
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${formatAnamnesisDate(date)} às ${hours}:${minutes}`
}

// Nome do responsável, com fallback explícito quando não há usuário ligado.
export function formatResponsible(name: string | null | undefined): string {
  const trimmed = name?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : "Não identificado"
}

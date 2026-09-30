import { z } from "zod"

// ===========================================================================
// Validação da FINALIZAÇÃO DO ATENDIMENTO — módulo Atendimento (Parte 9).
//
// O cliente NUNCA define:
//   - o paciente (resolvido do atendimento);
//   - os timestamps (started_at/finished_at são gerados no servidor);
//   - a duração (derivada dos timestamps);
//   - o status final (definido pelo domínio);
//   - o usuário autenticado (resolvido no servidor).
//
// O payload carrega apenas o necessário para identificar o responsável e
// confirmar a intenção de encerramento.
// ===========================================================================

const responsibleNameSchema = z
  .string()
  .trim()
  .min(2, "Informe o nome do profissional responsável.")
  .max(120, "Nome do profissional muito longo.")

// Confirmação explícita: não finalizar como efeito colateral de outro clique.
export const finalizeAttendanceSchema = z.object({
  responsibleName: responsibleNameSchema,
  // Identificador do profissional CADASTRADO que está executando o
  // encerramento. Quando presente e válido, o backend resolve o nome e o
  // conselho a partir do cadastro (fonte autoritativa) e os congela no
  // atendimento. Quando ausente, mantém-se a identidade textual legada.
  professionalId: z.string().trim().uuid().optional().nullable(),
  // Se true, o servidor NÃO finaliza, apenas devolve a avaliação de pendências.
  // (Permite a etapa de revisão sem duplicar a lógica no frontend.)
  preview: z.boolean().default(false),
  // Confirmação do usuário de que revisou o atendimento. Obrigatória para
  // finalizar (protege contra ações irreversíveis sem confirmação).
  confirmed: z.boolean().default(false),
  // Idempotência: se o atendimento já estiver finalizado, a operação devolve
  // o estado atual sem erro quando a chave coincide com a última finalização.
  idempotencyKey: z.string().trim().max(120).optional().nullable(),
})

export type FinalizeAttendanceInput = z.infer<typeof finalizeAttendanceSchema>

// ---------------------------------------------------------------------------
// Respostas (contrato com o frontend)
// ---------------------------------------------------------------------------

export interface FinalizationPendingView {
  code: string
  severity: "blocking" | "warning" | "info"
  area:
    | "attendance"
    | "professional"
    | "procedures"
    | "record"
    | "evolution"
    | "odontogram"
    | "anamnesis"
  title: string
  description: string
  action: string
}

export interface FinalizationPreviewResponse {
  canFinalize: boolean
  blocking: FinalizationPendingView[]
  warnings: FinalizationPendingView[]
  info: FinalizationPendingView[]
  blockingReason: string | null
  summary: {
    patientName: string | null
    status: string
    statusLabel: string
    startedAt: string | null
    durationMinutes: number | null
    durationLabel: string | null
    proceduresScheduled: number
    proceduresPerformed: number
    proceduresNotPerformed: number
    proceduresPending: number
    recordFilled: boolean
    evolutionRegistered: boolean
    odontogramUpdated: boolean
  }
}

export interface FinalizeAttendanceResponse {
  success: true
  // true quando a finalização foi executada; false em preview.
  finalized: boolean
  // Idempotência: true quando a operação encontrou o atendimento já finalizado.
  alreadyFinalized: boolean
  finalizedAt: string | null
  startedAt: string | null
  durationMinutes: number | null
  responsibleName: string | null
  // Snapshot do conselho no momento da finalização (ex.: "CRO-PE 12345").
  // Nulo quando o responsável não corresponde a um profissional cadastrado.
  responsibleCouncil?: string | null
}

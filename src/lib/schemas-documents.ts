import { z } from "zod"
import { DOCUMENT_CATEGORIES, MAX_DOCUMENT_SIZE_BYTES } from "@/lib/document-domain"

// ===========================================================================
// Validação dos DOCUMENTOS / IMAGENS — Módulo Atendimento (Parte 10.3).
//
// O upload é multipart/form-data: os campos chegam como texto e são
// normalizados aqui. A validação de tipo/tamanho do ARQUIVO é feita pela
// camada de domínio (mesma função usada no cliente) e reconfirmada no serviço.
//
// O cliente NUNCA define: o paciente (resolvido do atendimento), o caminho de
// storage (gerado no servidor), o autor do upload (identidade resolvida no
// servidor) nem a data do registro.
// ===========================================================================

const optionalText = (max: number) =>
  z
    .string()
    .max(max, `Texto deve ter no máximo ${max} caracteres`)
    .optional()
    .nullable()
    .transform((value) => {
      if (value === undefined || value === null) return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

const categorySchema = z.enum(
  DOCUMENT_CATEGORIES as [string, ...string[]],
  { message: "Categoria de documento inválida." }
)

export const uploadDocumentSchema = z
  .object({
    category: categorySchema,
    title: z
      .string()
      .trim()
      .min(2, "Informe um título para o documento.")
      .max(200, "Título muito longo."),
    description: optionalText(1000),
    originalName: z
      .string()
      .trim()
      .min(1, "Nome do arquivo não informado.")
      .max(260, "Nome do arquivo muito longo."),
    mimeType: z
      .string()
      .trim()
      .min(1, "Tipo do arquivo não informado.")
      .max(120, "Tipo do arquivo inválido."),
    sizeBytes: z
      .number()
      .int()
      .min(1, "O arquivo está vazio.")
      .max(
        MAX_DOCUMENT_SIZE_BYTES,
        "O arquivo excede o tamanho máximo permitido (20 MB)."
      ),
    // Dente relacionado (opcional) — MESMA numeração FDI do odontograma.
    toothNumber: z
      .string()
      .trim()
      .regex(/^\d{2}$/, "Número do dente deve seguir o padrão FDI (ex.: 26).")
      .optional()
      .nullable(),
    dentition: z.enum(["permanent", "deciduous"]).optional().nullable(),
    uploadedByName: optionalText(120),
  })
  .superRefine((value, ctx) => {
    if (!value.originalName || !value.originalName.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["originalName"],
        message: "Nome do arquivo é obrigatório.",
      })
    }
  })

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: optionalText(1000),
  category: categorySchema.optional(),
  toothNumber: z
    .string()
    .trim()
    .regex(/^\d{2}$/, "Número do dente deve seguir o padrão FDI (ex.: 26).")
    .optional()
    .nullable(),
  dentition: z.enum(["permanent", "deciduous"]).optional().nullable(),
})

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>

// ---------------------------------------------------------------------------
// Respostas (contrato com o frontend)
// ---------------------------------------------------------------------------

export interface DocumentView {
  id: string
  category: string
  title: string
  description: string | null
  originalName: string
  mimeType: string
  sizeBytes: number
  toothNumber: string | null
  dentition: string | null
  appointmentId: string | null
  uploadedByName: string | null
  archivedAt: string | null
  createdAt: string
  // URL da API para visualização (o conteúdo real fica sob autorização).
  contentUrl: string
}

export interface DocumentsResponse {
  patient: { id: string; fullName: string; cpf: string }
  appointment: {
    id: string
    code: string
    date: string
    time: string | null
  } | null
  documents: DocumentView[]
  totals: {
    total: number
    images: number
    pdfs: number
    byCategory: Record<string, number>
  }
}

// Alias usado pela UI (mesmo contrato do endpoint).
export type DocumentsApiResponse = DocumentsResponse

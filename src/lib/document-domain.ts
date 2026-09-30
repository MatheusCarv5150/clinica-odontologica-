// ===========================================================================
// DOMÍNIO DE DOCUMENTOS / IMAGENS — Módulo Atendimento (Parte 10.3).
//
// Regras puras de categorização, validação de tipo/tamanho e formatação.
// As mesmas regras são aplicadas no SERVIDOR (autoridade final) — o cliente
// valida apenas para dar feedback rápido ao usuário.
// ===========================================================================

export type DocumentCategory =
  | "radiograph"
  | "intraoral_photo"
  | "extraoral_photo"
  | "exam"
  | "document"
  | "other"

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  "radiograph",
  "intraoral_photo",
  "extraoral_photo",
  "exam",
  "document",
  "other",
]

export const DOCUMENT_CATEGORY_META: Record<
  DocumentCategory,
  { label: string; description: string; className: string }
> = {
  radiograph: {
    label: "Radiografia",
    description: "Radiografias periapicais, panorâmicas, interproximais.",
    className: "border-blue-200 bg-blue-50 text-blue-800",
  },
  intraoral_photo: {
    label: "Foto intraoral",
    description: "Fotografias do interior da cavidade bucal.",
    className: "border-cyan-200 bg-cyan-50 text-cyan-800",
  },
  extraoral_photo: {
    label: "Foto extrabucal",
    description: "Fotografias externas do paciente (perfil, frontal).",
    className: "border-teal-200 bg-teal-50 text-teal-800",
  },
  exam: {
    label: "Exame",
    description: "Exames laboratoriais, tomografias e laudos.",
    className: "border-indigo-200 bg-indigo-50 text-indigo-800",
  },
  document: {
    label: "Documento",
    description: "Termos, encaminhamentos, atestados e PDFs clínicos.",
    className: "border-gray-300 bg-gray-100 text-gray-700",
  },
  other: {
    label: "Outro",
    description: "Demais arquivos clínicos do paciente.",
    className: "border-gray-300 bg-gray-50 text-gray-600",
  },
}

export function isDocumentCategory(value: unknown): value is DocumentCategory {
  return (
    typeof value === "string" &&
    (DOCUMENT_CATEGORIES as string[]).includes(value)
  )
}

export function getDocumentCategoryMeta(category: string) {
  return (
    DOCUMENT_CATEGORY_META[category as DocumentCategory] ??
    DOCUMENT_CATEGORY_META.other
  )
}

// ---------------------------------------------------------------------------
// Limites e tipos aceitos (validados no servidor)
// ---------------------------------------------------------------------------

// 20 MB por arquivo — limite prudente para imagens/PDFs clínicos.
export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024

// Extensões/mime types aceitos. Documentos clínicos são imagens ou PDF.
export const ACCEPTED_DOCUMENT_MIME_TYPES: string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "application/pdf",
]

export const ACCEPTED_DOCUMENT_EXTENSIONS: string[] = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "pdf",
]

export function getFileExtension(fileName: string): string {
  const clean = fileName.trim().toLowerCase()
  const index = clean.lastIndexOf(".")
  if (index === -1 || index === clean.length - 1) return ""
  return clean.slice(index + 1)
}

export interface DocumentFileValidationInput {
  fileName: string
  mimeType: string
  sizeBytes: number
}

export interface DocumentFileValidationResult {
  ok: boolean
  error?: string
  code?: "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE"
}

// Valida um arquivo recebido. É usada no servidor ANTES de gravar qualquer
// coisa, e repetida no cliente para feedback imediato.
export function validateDocumentFile(
  input: DocumentFileValidationInput
): DocumentFileValidationResult {
  if (!input.fileName || input.sizeBytes <= 0) {
    return {
      ok: false,
      code: "EMPTY",
      error: "O arquivo está vazio ou não foi informado.",
    }
  }

  if (input.sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
    return {
      ok: false,
      code: "TOO_LARGE",
      error: `O arquivo excede o limite de ${formatFileSize(
        MAX_DOCUMENT_SIZE_BYTES
      )}.`,
    }
  }

  const extension = getFileExtension(input.fileName)
  const mimeOk =
    input.mimeType && ACCEPTED_DOCUMENT_MIME_TYPES.includes(input.mimeType)
  const extensionOk =
    extension.length > 0 && ACCEPTED_DOCUMENT_EXTENSIONS.includes(extension)

  // Aceita quando o MIME é reconhecido OU a extensão é conhecida — alguns
  // navegadores enviam mime vazio para PDFs/imagens legítimas.
  if (!mimeOk && !extensionOk) {
    return {
      ok: false,
      code: "UNSUPPORTED_TYPE",
      error:
        "Tipo de arquivo não suportado. Envie imagens (JPG, PNG, WEBP) ou PDF.",
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Apresentação
// ---------------------------------------------------------------------------

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded.toString().replace(".", ",")} ${units[unit]}`
}

export function isImageDocument(mimeType: string): boolean {
  return mimeType.startsWith("image/")
}

export function isPdfDocument(mimeType: string): boolean {
  return mimeType === "application/pdf"
}

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import {
  getDocumentCategoryMeta,
  isImageDocument,
  isPdfDocument,
  validateDocumentFile,
} from "@/lib/document-domain"
import { buildFriendlyCode } from "@/lib/attendance-status"
import type {
  DocumentView,
  DocumentsResponse,
  UpdateDocumentInput,
  UploadDocumentInput,
} from "@/lib/schemas-documents"

// ===========================================================================
// SERVIÇO DE DOCUMENTOS / IMAGENS (Parte 10.3).
//
// RESPONSABILIDADES
// - Armazenar arquivos clínicos do PACIENTE (opcionalmente vinculados ao
//   ATENDIMENTO) com metadados persistidos no banco.
// - Resolver o paciente SEMPRE a partir do atendimento (isolamento/LGPD).
// - Preservar o histórico: exclusões são LÓGICAS (archived_at).
//
// ARMAZENAMENTO
// - O CONTEÚDO fica no provedor abstrato `storage` (nesta etapa, filesystem
//   local em ./storage). Trocar por object storage no futuro exige apenas
//   substituir `storage.put/get/remove` — o contrato do serviço não muda.
//
// NÃO FAZ:
// - não grava nada em diretório público (o conteúdo é servido por rota
//   autenticada que resolve o paciente a partir do atendimento).
// ===========================================================================

export type ServiceError = { error: string; code: string; status: number }

// ---------------------------------------------------------------------------
// Provedor de storage (abstração trocável)
// ---------------------------------------------------------------------------

// Diretório raiz dos arquivos clínicos.
//
// Em PRODUÇÃO deve apontar para um VOLUME PERSISTENTE (ex.: /data/storage),
// configurado via STORAGE_PATH. O container pode ser recriado a qualquer
// momento; arquivos gravados no filesystem efêmero seriam PERDIDOS.
//
// Fallback para desenvolvimento: ./storage (dentro do projeto).
const STORAGE_ROOT = process.env.STORAGE_PATH
  ? path.resolve(process.env.STORAGE_PATH)
  : path.join(process.cwd(), "storage")

export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
}

const filesystemStorage: StorageProvider = {
  async put(key, data) {
    const target = path.join(STORAGE_ROOT, key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, data)
  },
  async get(key) {
    return readFile(path.join(STORAGE_ROOT, key))
  },
  async remove(key) {
    try {
      await unlink(path.join(STORAGE_ROOT, key))
    } catch {
      // Arquivo já ausente: nada a fazer (a remoção é lógica no banco).
    }
  },
}

export const storage: StorageProvider = filesystemStorage

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveAttendance(attendanceId: string) {
  return prisma.appointment.findUnique({
    where: { id: attendanceId },
    select: {
      id: true,
      patientId: true,
      appointmentDate: true,
      appointmentTime: true,
      patient: { select: { id: true, fullName: true, cpf: true } },
    },
  })
}

// Gera uma chave de storage isolada por paciente, sem expor o caminho do disco.
function buildStorageKey(patientId: string, originalName: string): string {
  const extension = path.extname(originalName).toLowerCase().slice(0, 10)
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return path.posix.join(patientId, `${unique}${extension}`)
}

type DocumentRow = {
  id: string
  patientId: string
  appointmentId: string | null
  category: string
  title: string
  description: string | null
  originalName: string
  mimeType: string
  sizeBytes: number
  toothNumber: string | null
  dentition: string | null
  uploadedByName: string | null
  archivedAt: Date | null
  createdAt: Date
}

function mapDocument(row: DocumentRow): DocumentView {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    description: row.description,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    toothNumber: row.toothNumber,
    dentition: row.dentition,
    appointmentId: row.appointmentId,
    uploadedByName: row.uploadedByName,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    contentUrl: `/api/attendance/documents/${row.id}/content`,
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function getDocuments(
  attendanceId: string
): Promise<DocumentsResponse | null> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) return null

  const rows = await prisma.patientDocument.findMany({
    where: {
      patientId: appointment.patientId,
      // Documentos arquivados (exclusão lógica) não aparecem na listagem padrão.
      archivedAt: null,
    },
    orderBy: { createdAt: "desc" },
  })

  const documents = rows.map(mapDocument)

  const byCategory: Record<string, number> = {}
  for (const doc of documents) {
    byCategory[doc.category] = (byCategory[doc.category] ?? 0) + 1
  }

  return {
    patient: {
      id: appointment.patient.id,
      fullName: appointment.patient.fullName,
      cpf: appointment.patient.cpf,
    },
    appointment: {
      id: appointment.id,
      code: buildFriendlyCode(appointment.id),
      date: appointment.appointmentDate.toISOString().split("T")[0],
      time: appointment.appointmentTime || null,
    },
    documents,
    totals: {
      total: documents.length,
      images: documents.filter((d) => isImageDocument(d.mimeType)).length,
      pdfs: documents.filter((d) => isPdfDocument(d.mimeType)).length,
      byCategory,
    },
  }
}

// ---------------------------------------------------------------------------
// Escrita — upload
// ---------------------------------------------------------------------------

export async function uploadDocument(
  attendanceId: string,
  input: UploadDocumentInput,
  file: Buffer
): Promise<{ ok: true; documentId: string } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  // --- Validação do arquivo (autoridade final) ---
  const validation = validateDocumentFile({
    fileName: input.originalName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  })

  if (!validation.ok) {
    return {
      error: validation.error ?? "Arquivo inválido.",
      code: validation.code ?? "INVALID_FILE",
      status: 422,
    }
  }

  // O tamanho real do buffer deve bater com o declarado (defesa contra
  // Content-Length adulterado).
  if (file.byteLength !== input.sizeBytes) {
    return {
      error: "O tamanho do arquivo não corresponde ao informado.",
      code: "SIZE_MISMATCH",
      status: 422,
    }
  }

  // --- Dente (opcional) — MESMA numeração FDI do odontograma ---
  let toothNumber: string | null = null
  let dentition: string | null = null
  if (input.toothNumber) {
    const { getToothDefinition } = await import("@/lib/tooth-catalog")
    const tooth = getToothDefinition(input.toothNumber)
    if (!tooth) {
      return {
        error: `Dente "${input.toothNumber}" não é um número FDI válido.`,
        code: "INVALID_TOOTH",
        status: 400,
      }
    }
    toothNumber = tooth.number
    dentition = input.dentition ?? tooth.dentition
    if (dentition !== tooth.dentition) {
      return {
        error: `O dente ${toothNumber} não pertence à dentição informada.`,
        code: "WRONG_DENTITION",
        status: 400,
      }
    }
  }

  const storageKey = buildStorageKey(appointment.patientId, input.originalName)

  // Grava o conteúdo no storage e só então persiste os metadados: se o storage
  // falhar, nenhum registro órfão é criado.
  try {
    await storage.put(storageKey, file)
  } catch {
    return {
      error: "Não foi possível armazenar o arquivo. Tente novamente.",
      code: "STORAGE_ERROR",
      status: 500,
    }
  }

  try {
    const document = await prisma.patientDocument.create({
      data: {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        category: input.category,
        title: input.title,
        description: input.description,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey,
        toothNumber,
        dentition,
        uploadedByName: input.uploadedByName,
      },
      select: { id: true },
    })

    return { ok: true, documentId: document.id }
  } catch {
    // Reverte o arquivo no storage para não deixar lixo órfão.
    await storage.remove(storageKey)
    return {
      error: "Não foi possível registrar o documento. Tente novamente.",
      code: "PERSIST_ERROR",
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// Escrita — atualizar metadados
// ---------------------------------------------------------------------------

export async function updateDocument(
  attendanceId: string,
  documentId: string,
  input: UpdateDocumentInput
): Promise<{ ok: true } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const document = await prisma.patientDocument.findFirst({
    where: { id: documentId, patientId: appointment.patientId, archivedAt: null },
    select: { id: true },
  })

  if (!document) {
    return {
      error: "Documento não encontrado para este paciente.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  await prisma.patientDocument.update({
    where: { id: document.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.toothNumber !== undefined ? { toothNumber: input.toothNumber } : {}),
      ...(input.dentition !== undefined ? { dentition: input.dentition } : {}),
    },
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Escrita — arquivar (exclusão LÓGICA, preservando o histórico clínico)
// ---------------------------------------------------------------------------

export async function archiveDocument(
  attendanceId: string,
  documentId: string
): Promise<{ ok: true } | ServiceError> {
  const appointment = await resolveAttendance(attendanceId)
  if (!appointment) {
    return { error: "Atendimento não encontrado.", code: "NOT_FOUND", status: 404 }
  }

  const document = await prisma.patientDocument.findFirst({
    where: { id: documentId, patientId: appointment.patientId, archivedAt: null },
    select: { id: true },
  })

  if (!document) {
    return {
      error: "Documento não encontrado para este paciente.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  await prisma.patientDocument.update({
    where: { id: document.id },
    data: { archivedAt: new Date() },
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Leitura do conteúdo (autorizada)
// ---------------------------------------------------------------------------

export interface DocumentContent {
  documentId: string
  mimeType: string
  originalName: string
  data: Buffer
}

// Resolve o documento a partir do PACIENTE (nunca de um id solto do cliente).
export async function getDocumentContent(
  documentId: string
): Promise<DocumentContent | ServiceError> {
  const document = await prisma.patientDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      mimeType: true,
      originalName: true,
      storageKey: true,
      archivedAt: true,
    },
  })

  if (!document) {
    return {
      error: "Documento não encontrado.",
      code: "NOT_FOUND",
      status: 404,
    }
  }

  try {
    const data = await storage.get(document.storageKey)
    return {
      documentId: document.id,
      mimeType: document.mimeType,
      originalName: document.originalName,
      data,
    }
  } catch {
    return {
      error: "Arquivo não encontrado no armazenamento.",
      code: "CONTENT_NOT_FOUND",
      status: 404,
    }
  }
}

// Reexporta os metadados de categoria para a UI não recriar as listas.
export { getDocumentCategoryMeta }

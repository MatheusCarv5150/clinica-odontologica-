import { NextRequest, NextResponse } from "next/server"
import { getDocuments, uploadDocument } from "@/lib/document-service"
import { uploadDocumentSchema } from "@/lib/schemas-documents"
import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/document-domain"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/documents
//
// Documentos/imagens do paciente vinculados ao atendimento. O paciente é
// resolvido SEMPRE no servidor a partir do atendimento (isolamento/LGPD).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json(
        { error: "Identificador do atendimento não informado." },
        { status: 400 }
      )
    }

    const data = await getDocuments(id)
    if (!data) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Erro ao carregar documentos:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// POST /api/attendance/[id]/documents
//
// Upload multipart/form-data de um documento clínico (imagem ou PDF).
//
// O arquivo é validado no SERVIDOR (tipo, tamanho, conteúdo) antes de qualquer
// gravação. O paciente e o autor são resolvidos no servidor; o caminho de
// storage é gerado internamente e nunca expõe o disco.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json(
        { error: "Identificador do atendimento não informado." },
        { status: 400 }
      )
    }

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json(
        { error: "Requisição de upload inválida." },
        { status: 400 }
      )
    }

    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Nenhum arquivo foi enviado." },
        { status: 400 }
      )
    }

    // Limite preliminar ANTES de ler o arquivo inteiro na memória.
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      return NextResponse.json(
        {
          error:
            "O arquivo excede o tamanho máximo permitido (20 MB).",
          code: "TOO_LARGE",
        },
        { status: 413 }
      )
    }

    const parsed = uploadDocumentSchema.safeParse({
      category: formData.get("category"),
      title: formData.get("title"),
      description: formData.get("description"),
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      toothNumber: formData.get("toothNumber"),
      dentition: formData.get("dentition"),
      uploadedByName: formData.get("uploadedByName"),
    })

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Dados inválidos.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await uploadDocument(id, parsed.data, buffer)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(
      { ...result, savedAt: new Date().toISOString() },
      { status: 201 }
    )
  } catch (error) {
    console.error("Erro ao enviar documento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

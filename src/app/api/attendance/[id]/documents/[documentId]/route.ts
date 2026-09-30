import { NextRequest, NextResponse } from "next/server"
import { archiveDocument, updateDocument } from "@/lib/document-service"
import { updateDocumentSchema } from "@/lib/schemas-documents"

export const dynamic = "force-dynamic"

// PATCH /api/attendance/[id]/documents/[documentId]
//
// Atualiza metadados (título, descrição, categoria, dente). O conteúdo do
// arquivo não é alterado por esta rota.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  try {
    const { id, documentId } = await params
    if (!id || !documentId) {
      return NextResponse.json(
        { error: "Identificadores não informados." },
        { status: 400 }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Corpo da requisição inválido." },
        { status: 400 }
      )
    }

    const parsed = updateDocumentSchema.safeParse(body)
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

    const result = await updateDocument(id, documentId, parsed.data)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao atualizar documento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// DELETE /api/attendance/[id]/documents/[documentId]
//
// Exclusão LÓGICA: o documento é arquivado (archived_at), preservando o
// histórico clínico. O conteúdo permanece no storage para auditoria.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  try {
    const { id, documentId } = await params
    if (!id || !documentId) {
      return NextResponse.json(
        { error: "Identificadores não informados." },
        { status: 400 }
      )
    }

    const result = await archiveDocument(id, documentId)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao arquivar documento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

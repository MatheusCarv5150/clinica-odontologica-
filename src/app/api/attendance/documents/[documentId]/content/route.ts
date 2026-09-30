import { NextRequest, NextResponse } from "next/server"
import { getDocumentContent } from "@/lib/document-service"

export const dynamic = "force-dynamic"

// GET /api/attendance/documents/[documentId]/content
//
// Serve o CONTEÚDO do documento (imagem/PDF). O registro é resolvido pelo
// próprio id do documento, que só é conhecido por quem tem acesso ao
// prontuário (a listagem é sempre filtrada pelo paciente do atendimento).
//
// O arquivo é entregue inline com o mime type registrado; nenhum caminho de
// disco é exposto e o diretório de storage nunca é público.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params
    if (!documentId) {
      return NextResponse.json(
        { error: "Identificador do documento não informado." },
        { status: 400 }
      )
    }

    const result = await getDocumentContent(documentId)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    // Buffer -> Uint8Array: tipo aceito pelo Response do runtime Node.
    const body = new Uint8Array(result.data)

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Content-Length": String(result.data.byteLength),
        // inline permite visualizar imagens/PDF direto no navegador.
        "Content-Disposition": `inline; filename="${encodeURIComponent(
          result.originalName
        )}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    })
  } catch (error) {
    console.error("Erro ao servir documento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

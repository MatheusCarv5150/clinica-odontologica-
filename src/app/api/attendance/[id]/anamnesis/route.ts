import { NextRequest, NextResponse } from "next/server"
import { getAnamnesis, saveAnamnesis } from "@/lib/anamnesis-service"
import { saveAnamnesisSchema } from "@/lib/schemas-anamnesis"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/anamnesis
//
// Anamnese do paciente dono do atendimento, já separada em:
// - clinical: perfil clínico versionado (dado permanente do paciente);
// - session:  informações específicas DESTE atendimento.
//
// Segurança: o paciente nunca é recebido por parâmetro — é resolvido no
// servidor a partir do atendimento.
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

    const data = await getAnamnesis(id)
    if (!data) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Erro ao carregar anamnese:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// PUT /api/attendance/[id]/anamnesis
//
// Salva a anamnese do atendimento:
// - `clinical` (opcional): gera uma NOVA versão do perfil clínico do paciente
//   e registra as alterações na trilha de auditoria. Versões anteriores são
//   preservadas.
// - `session`: grava/atualiza os dados do atendimento atual.
//
// Validação defensiva de todo o payload via Zod.
export async function PUT(
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

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Corpo da requisição inválido." },
        { status: 400 }
      )
    }

    const parsed = saveAnamnesisSchema.safeParse(body)
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

    const result = await saveAnamnesis(id, {
      clinical: parsed.data.clinical,
      session: parsed.data.session,
      responsibleName: parsed.data.responsibleName,
    })

    if (!result) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      clinicalVersion: result.clinicalVersion,
      changes: result.changes,
      sessionId: result.sessionId,
      savedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Erro ao salvar anamnese:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

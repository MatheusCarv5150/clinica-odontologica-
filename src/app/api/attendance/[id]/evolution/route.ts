import { NextRequest, NextResponse } from "next/server"
import { getEvolution, finalizeEvolution, saveEvolution } from "@/lib/evolution-service"
import { saveEvolutionSchema } from "@/lib/schemas-evolution"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/evolution
//
// Retorna o registro de evolução clínica do atendimento, incluindo
// resumo do atendimento, referências da anamnese e odontograma.
//
// Segurança: o paciente nunca é recebido por parâmetro — é resolvido
// no servidor a partir do atendimento.
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

    const data = await getEvolution(id)
    if (!data) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Erro ao carregar evolução:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// PUT /api/attendance/[id]/evolution
//
// Salva o registro de evolução clínica do atendimento.
//
// - `finalize: true` finaliza o atendimento e bloqueia alterações
//   silenciosas (exige rastreabilidade para mudanças futuras).
// - Procedimentos são upserted por (evolutionId, procedureId, toothNumber, surfaces).
// - A validação defensiva de todo o payload é feita via Zod.
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

    const parsed = saveEvolutionSchema.safeParse(body)
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

    const result = await saveEvolution(id, parsed.data)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(
      { ...result, savedAt: new Date().toISOString() },
      { status: 200 }
    )
  } catch (error) {
    console.error("Erro ao salvar evolução:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// POST /api/attendance/[id]/evolution/finalize
//
// Finaliza o registro de evolução do atendimento.
//
// Após a finalização:
// - O registro clínico não é mais editável de forma silenciosa.
// - Alterações importantes exigem registro de correção/auditoria.
// - O atendimento permanece acessível para consulta.
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

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Corpo da requisição inválido." },
        { status: 400 }
      )
    }

    const responsibleName =
      typeof body === "object" && body !== null && "responsibleName" in body
        ? (body as { responsibleName?: string }).responsibleName
        : null

    if (!responsibleName || typeof responsibleName !== "string" || !responsibleName.trim()) {
      return NextResponse.json(
        { error: "Nome do responsável é obrigatório para finalizar." },
        { status: 400 }
      )
    }

    const result = await finalizeEvolution(id, responsibleName.trim())

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error("Erro ao finalizar evolução:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

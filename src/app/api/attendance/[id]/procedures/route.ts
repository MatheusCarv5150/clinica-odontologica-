import { NextRequest, NextResponse } from "next/server"
import { getProcedures, registerExecution } from "@/lib/procedures-service"
import { registerProcedureExecutionSchema } from "@/lib/schemas-procedures"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/procedures
//
// Procedimentos do atendimento: o que estava PREVISTO (Agenda) e o que foi
// REALIZADO/registrado durante o atendimento, com a comparação entre os dois.
//
// Segurança (LGPD): o paciente NUNCA é recebido por parâmetro — é resolvido no
// servidor a partir do atendimento. Assim, não há como acessar dados de outro
// paciente alterando IDs na URL.
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

    const data = await getProcedures(id)
    if (!data) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Erro ao carregar procedimentos do atendimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// POST /api/attendance/[id]/procedures
//
// Registra a EXECUÇÃO de um procedimento no atendimento:
// - origem "scheduled": confirma/marca um item que veio da Agenda;
// - origem "added_in_attendance": adiciona um procedimento identificado na
//   consulta (sem alterar a Agenda original).
//
// A validação do payload é feita via Zod; as regras de negócio (inclusive a
// alteração de valor) são validadas no SERVIÇO — autoridade final.
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

    const parsed = registerProcedureExecutionSchema.safeParse(body)
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

    const result = await registerExecution(id, parsed.data)

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
    console.error("Erro ao registrar procedimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

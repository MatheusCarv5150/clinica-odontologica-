import { NextRequest, NextResponse } from "next/server"
import {
  finalizeAttendance,
  previewFinalization,
  type AuthenticatedActor,
} from "@/lib/attendance-finalization-service"
import { finalizeAttendanceSchema } from "@/lib/schemas-finalization"

export const dynamic = "force-dynamic"

// POST /api/attendance/[id]/finalize
//
// Encerramento formal do atendimento (Parte 9).
//
// Fluxo em duas intenções, sem duplicar regra no frontend:
//  - preview: true  → apenas VALIDA e devolve a avaliação de pendências
//    (etapa de revisão). Nada é gravado.
//  - preview: false + confirmed: true → executa a FINALIZAÇÃO transacional.
//
// Segurança / integridade:
//  - O paciente é resolvido SEMPRE a partir do atendimento (nunca do cliente).
//  - Os timestamps (started_at/finished_at) e a duração são gerados/derivados
//    NO SERVIDOR — o relógio do navegador nunca é confiado.
//  - O status final ("completed") vem do domínio; nenhum status paralelo.
//  - A operação é idempotente e protegida contra concorrência.
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

    const parsed = finalizeAttendanceSchema.safeParse(body)
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

    const { responsibleName, professionalId, preview, confirmed } = parsed.data

    // --- Etapa de revisão: apenas valida, não grava. ---
    if (preview) {
      const result = await previewFinalization(id, responsibleName)
      if ("error" in result) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: result.status }
        )
      }
      return NextResponse.json(result, { status: 200 })
    }

    // --- Ação irreversível exige confirmação explícita. ---
    if (!confirmed) {
      return NextResponse.json(
        {
          error:
            "É necessário confirmar a revisão antes de finalizar o atendimento.",
          code: "CONFIRMATION_REQUIRED",
        },
        { status: 422 }
      )
    }

    // O backend determina o usuário autenticado. Enquanto a arquitetura não
    // possui módulo de sessão, o profissional cadastrado é identificado pelo
    // `professionalId`; quando ele existe, o nome e o conselho são resolvidos
    // no cadastro (fonte autoritativa). Sem ele, mantém-se a identidade textual
    // legada usada pelo restante do prontuário (mesma abordagem das P4/6/7).
    const actor: AuthenticatedActor = {
      userId: professionalId ?? null,
      name: responsibleName,
    }

    const result = await finalizeAttendance(id, actor)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error("Erro ao finalizar atendimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

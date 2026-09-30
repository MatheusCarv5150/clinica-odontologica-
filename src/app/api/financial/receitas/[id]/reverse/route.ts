import { NextRequest, NextResponse } from "next/server"
import { reverseReceita } from "@/lib/financial-receitas-service"
import { reverseReceitaSchema } from "@/lib/schemas-financial"

export const dynamic = "force-dynamic"

// POST /api/financial/receitas/[id]/reverse
// ESTORNO: NÃO apaga o registro. Marca a movimentação como `reversed` (fora de
// todos os totais) e o pagamento de origem como `refunded`, preservando
// data, responsável e motivo.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const parsed = reverseReceitaSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Dados inválidos.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    )
  }

  try {
    const { id } = await context.params
    if (!id || id.trim() === "") {
      return NextResponse.json({ error: "Identificador é obrigatório." }, { status: 400 })
    }

    const receita = await reverseReceita({
      id,
      reason: parsed.data.reason ?? null,
      actorName: parsed.data.actorName,
    })

    if (!receita) {
      return NextResponse.json({ error: "Receita não encontrada." }, { status: 404 })
    }

    return NextResponse.json(receita)
  } catch (error) {
    console.error("Erro ao estornar receita:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

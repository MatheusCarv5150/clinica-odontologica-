import { NextRequest, NextResponse } from "next/server"
import { getReceitaDetail } from "@/lib/financial-receitas-service"

export const dynamic = "force-dynamic"

// GET /api/financial/receitas/[id]
// Aceita o id da movimentação OU o id do pagamento de origem (link estável).
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    if (!id || id.trim() === "") {
      return NextResponse.json({ error: "Identificador é obrigatório." }, { status: 400 })
    }

    const receita = await getReceitaDetail(id)
    if (!receita) {
      return NextResponse.json({ error: "Receita não encontrada." }, { status: 404 })
    }

    return NextResponse.json(receita)
  } catch (error) {
    console.error("Erro ao carregar detalhe da receita:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

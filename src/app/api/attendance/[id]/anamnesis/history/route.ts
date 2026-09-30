import { NextRequest, NextResponse } from "next/server"
import { getAnamnesisHistory } from "@/lib/anamnesis-service"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/anamnesis/history
//
// Histórico de alterações do perfil clínico do paciente dono do atendimento.
// Registra quem alterou, quando, o que mudou e os valores anterior/novo.
//
// Segurança: o paciente é resolvido no servidor a partir do atendimento.
export async function GET(
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

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") || "100", 10) || 100

    const result = await getAnamnesisHistory(id, limit)
    if (!result) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao carregar histórico da anamnese:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

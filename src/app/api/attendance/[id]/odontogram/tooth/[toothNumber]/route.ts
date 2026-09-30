import { NextRequest, NextResponse } from "next/server"
import { getToothDetail } from "@/lib/odontogram-service"
import { isKnownToothNumber } from "@/lib/tooth-catalog"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/odontogram/tooth/[toothNumber]
//
// Detalhe clínico de UM dente:
// - situação atual (projeção das condições ativas);
// - condições ativas;
// - timeline (histórico, somente leitura).
//
// Segurança: o paciente é resolvido do atendimento; o histórico é filtrado
// pelo paciente E pelo dente. Não há como ler o dente de outro paciente
// alterando a URL.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; toothNumber: string }> }
) {
  try {
    const { id, toothNumber } = await params

    if (!id) {
      return NextResponse.json(
        { error: "Identificador do atendimento não informado." },
        { status: 400 }
      )
    }

    if (!isKnownToothNumber(toothNumber)) {
      return NextResponse.json(
        { error: `Dente "${toothNumber}" não é um número FDI válido.` },
        { status: 400 }
      )
    }

    const data = await getToothDetail(id, toothNumber)
    if (!data) {
      return NextResponse.json(
        { error: "Atendimento ou dente não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("Erro ao carregar detalhe do dente:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

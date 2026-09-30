import { NextRequest, NextResponse } from "next/server"
import {
  getOdontogram,
  registerEvent,
} from "@/lib/odontogram-service"
import {
  odontogramQuerySchema,
  registerOdontogramEventSchema,
} from "@/lib/schemas-odontogram"
import { CONDITION_CATALOG, CONDITION_CATEGORY_LABELS } from "@/lib/odontogram-domain"
import { DENTITIONS, type Dentition } from "@/lib/tooth-catalog"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/odontogram?dentition=permanent&view=current
//
// Odontograma do paciente dono do atendimento. Retorna o ESTADO ATUAL de
// todos os dentes da dentição escolhida, derivado dos eventos clínicos.
//
// Segurança: o paciente NUNCA vem por parâmetro — é resolvido do atendimento.
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
    const parsed = odontogramQuerySchema.safeParse({
      dentition: searchParams.get("dentition") ?? undefined,
      view: searchParams.get("view") ?? undefined,
      numbering: searchParams.get("numbering") ?? undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Parâmetros inválidos.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      )
    }

    const dentition = parsed.data.dentition as Dentition

    const data = await getOdontogram(id, dentition)
    if (!data) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      ...data,
      // Catálogo exposto pela API para o frontend montar o seletor a partir da
      // mesma fonte da verdade do backend (nunca uma lista paralela na tela).
      catalog: {
        conditions: CONDITION_CATALOG,
        categories: CONDITION_CATEGORY_LABELS,
      },
      dentitions: DENTITIONS,
    })
  } catch (error) {
    console.error("Erro ao carregar odontograma:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// POST /api/attendance/[id]/odontogram
//
// Registra uma CONDIÇÃO ou um PROCEDIMENTO em um ou mais dentes.
//
// Regras validadas no servidor (autoridade final):
// - Condição e procedimento são entidades distintas (`kind`).
// - Procedimento referencia o catálogo REAL (`procedures`), com snapshot.
// - Procedimentos aceitam status "planned" (Plano de Tratamento) ou
//   "performed".
// - O atendimento precisa estar em andamento.
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

    const parsed = registerOdontogramEventSchema.safeParse(body)
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

    const result = await registerEvent(id, parsed.data)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(
      { success: true, ...result, savedAt: new Date().toISOString() },
      { status: 201 }
    )
  } catch (error) {
    console.error("Erro ao registrar evento do odontograma:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

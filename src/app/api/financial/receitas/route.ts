import { NextRequest, NextResponse } from "next/server"
import {
  listReceitas,
  registerReceita,
  RECEITA_STATUS_LABELS,
} from "@/lib/financial-receitas-service"
import { listReceitasSchema, registerReceitaSchema } from "@/lib/schemas-financial"
import { PaymentError } from "@/lib/financial-payments-service"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// GET /api/financial/receitas
// ---------------------------------------------------------------------------
// Lista receitas com período, busca, filtros, ordenação e paginação — tudo
// resolvido no SERVIDOR. O cliente NUNCA recebe a base inteira.
//
// A sincronização NÃO acontece mais a cada leitura: ela é feita no momento em
// que um pagamento é criado (`registerPaymentForAppointment`) ou sob demanda
// pelo endpoint `/api/financial/sync-income`. Ler não deve escrever.

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const toNumber = (key: string, fallback: number) => {
      const raw = searchParams.get(key)
      if (raw == null || raw.trim() === "") return fallback
      const n = Number(raw)
      return Number.isFinite(n) ? n : fallback
    }

    const parsed = listReceitasSchema.safeParse({
      period: searchParams.get("period") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      paymentMethod: searchParams.get("paymentMethod") ?? undefined,
      origin: searchParams.get("origin") ?? undefined,
      professionalName: searchParams.get("professionalName") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      sort: searchParams.get("sort") ?? undefined,
      direction: searchParams.get("direction") ?? undefined,
      page: toNumber("page", 1),
      pageSize: toNumber("pageSize", 20),
    })

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Parâmetros inválidos.",
          details: parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      )
    }

    const result = await listReceitas(parsed.data)
    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao listar receitas:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/financial/receitas
// ---------------------------------------------------------------------------
// Registra um recebimento (total ou parcial) contra um ATENDIMENTO.
//
// O corpo NÃO aceita `patientId`: o paciente é derivado do atendimento no
// servidor. Isso impede que o cliente crie um relacionamento financeiro
// inconsistente (pagamento de um paciente ligado ao atendimento de outro).

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 })
  }

  const parsed = registerReceitaSchema.safeParse(body)
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
    const receita = await registerReceita(parsed.data)
    return NextResponse.json(
      {
        ...receita,
        statusLabel: RECEITA_STATUS_LABELS[receita.status] ?? receita.status,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof PaymentError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }
    console.error("Erro ao registrar recebimento:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

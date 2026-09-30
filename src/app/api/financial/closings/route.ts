// ===========================================================================
// API DE FECHAMENTO FINANCEIRO — módulo Financeiro (Financeiro 6).
// ===========================================================================
//
// GET  /api/financial/closings
//   - sem `id`: histórico paginado de fechamentos (opcional `status`).
//   - com `id`: detalhe de um fechamento (snapshot, comparação, auditoria).
//   - com `from`+`to`: VALIDAÇÃO pré-fechamento (não fecha, só avalia).
//
// POST /api/financial/closings
//   - body { from, to, notes?, actorName? } -> FECHA o período.
//
// POST /api/financial/closings?id=<closingId>&action=reopen
//   - body { reason, actorName? } -> REABRE o período (motivo obrigatório).
//
// O fechamento NÃO recebe valores financeiros do cliente: apenas o período e
// uma observação. Os números vêm dos serviços financeiros existentes.

import { NextRequest, NextResponse } from "next/server"
import {
  listClosings,
  getClosingDetail,
  validateClosing,
  closePeriod,
  reopenPeriod,
} from "@/lib/financial-closing-service"
import { isFinancialError } from "@/lib/financial-service"
import {
  closePeriodSchema,
  reopenClosingSchema,
  validateClosingSchema,
  listClosingsSchema,
} from "@/lib/schemas-financial"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    // Detalhe de um fechamento.
    if (id) {
      const detail = await getClosingDetail(id)
      if (!detail) {
        return NextResponse.json({ error: "Fechamento não encontrado." }, { status: 404 })
      }
      return NextResponse.json({ closing: detail })
    }

    // Validação pré-fechamento.
    const from = searchParams.get("from")
    const to = searchParams.get("to")
    if (from && to) {
      const parsed = validateClosingSchema.safeParse({ from, to })
      if (!parsed.success) return invalid(parsed.error.issues)
      const result = await validateClosing(parsed.data.from, parsed.data.to)
      if (isFinancialError(result)) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      return NextResponse.json(result)
    }

    // Histórico.
    const parsed = listClosingsSchema.safeParse({
      status: searchParams.get("status") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    })
    if (!parsed.success) return invalid(parsed.error.issues)

    const result = await listClosings(parsed.data)
    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao processar fechamentos:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST — fechar ou reabrir
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    const action = searchParams.get("action")
    const body = await readJson(request)

    // Reabertura.
    if (id && action === "reopen") {
      const parsed = reopenClosingSchema.safeParse(body)
      if (!parsed.success) return invalid(parsed.error.issues)

      const result = await reopenPeriod(id, parsed.data.reason, {
        userId: null,
        name: parsed.data.actorName ?? "",
      })
      if (isFinancialError(result)) {
        return NextResponse.json(
          { error: result.error, code: result.code },
          { status: result.status }
        )
      }
      return NextResponse.json({ closing: result })
    }

    // Fechamento do período.
    const parsed = closePeriodSchema.safeParse(body)
    if (!parsed.success) return invalid(parsed.error.issues)

    const result = await closePeriod({
      from: parsed.data.from,
      to: parsed.data.to,
      notes: parsed.data.notes ?? null,
      actor: { userId: null, name: parsed.data.actorName ?? "" },
    })
    if (isFinancialError(result)) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }
    return NextResponse.json({ closing: result }, { status: 201 })
  } catch (error) {
    console.error("Erro ao registrar fechamento:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

function invalid(details: unknown) {
  return NextResponse.json({ error: "Parâmetros inválidos.", details }, { status: 400 })
}

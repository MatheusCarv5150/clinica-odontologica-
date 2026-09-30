import { NextRequest, NextResponse } from "next/server"
import {
  ACCOUNT_STATUSES,
  listContasReceber,
  registerContaPayment,
} from "@/lib/financial-contas-receber-service"
import { parsePeriodFromSearchParams } from "@/lib/schemas-financial"
import { PaymentError } from "@/lib/financial-payments-service"

export const dynamic = "force-dynamic"

const MAX_PAGE_SIZE = 100

function parseNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isAccountStatus(value: string): boolean {
  return (ACCOUNT_STATUSES as readonly string[]).includes(value)
}

// GET /api/financial/contas-receber
//   ?period=month&from=&to=&status=&search=&page=&pageSize=
//   &patientName=&patientCpf=&procedureName=&professionalName=
//   &minAmount=&maxAmount=&sort=&direction=
//
// A resposta traz `contas`, `summary`, `pagination` e `period`.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const period = parsePeriodFromSearchParams(searchParams)

    const status = searchParams.get("status") ?? undefined
    if (status && !isAccountStatus(status)) {
      return NextResponse.json({ error: `Status inválido: ${status}.` }, { status: 400 })
    }

    const sortParam = searchParams.get("sort")
    const sort =
      sortParam === "dueDate" ||
      sortParam === "balance" ||
      sortParam === "patient" ||
      sortParam === "expected"
        ? sortParam
        : undefined

    const directionParam = searchParams.get("direction")
    const direction =
      directionParam === "asc" || directionParam === "desc" ? directionParam : undefined

    const page = parseNumber(searchParams.get("page"))
    const pageSize = parseNumber(searchParams.get("pageSize") ?? searchParams.get("limit"))

    const result = await listContasReceber({
      period: period.preset,
      from: period.from,
      to: period.to,
      status,
      search: searchParams.get("search") ?? undefined,
      patientName: searchParams.get("patientName") ?? undefined,
      patientCpf: searchParams.get("patientCpf") ?? undefined,
      procedureName: searchParams.get("procedureName") ?? undefined,
      professionalName: searchParams.get("professionalName") ?? undefined,
      minAmount: parseNumber(searchParams.get("minAmount")),
      maxAmount: parseNumber(searchParams.get("maxAmount")),
      sort,
      direction,
      page,
      // O serviço já limita a 100; aqui só evitamos valores absurdos na query.
      pageSize: pageSize === undefined ? undefined : Math.min(pageSize, MAX_PAGE_SIZE),
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao listar contas a receber:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

// POST /api/financial/contas-receber
// Registra um recebimento (parcial ou total) contra uma conta.
// Body: { appointmentId, amount, paymentMethod, actorName?, paidAt? }
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 })
  }

  const { appointmentId, amount, paymentMethod, actorName, paidAt } = body as {
    appointmentId?: string
    amount?: number
    paymentMethod?: string
    actorName?: string
    paidAt?: string
  }

  if (!appointmentId || amount === undefined || amount === null || !paymentMethod) {
    return NextResponse.json(
      { error: "Informe appointmentId, amount e paymentMethod." },
      { status: 400 }
    )
  }

  const parsedAmount = Number(amount)
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json(
      { error: "O valor do recebimento deve ser maior que zero." },
      { status: 400 }
    )
  }

  let parsedPaidAt: Date | undefined
  if (paidAt) {
    parsedPaidAt = new Date(paidAt)
    if (Number.isNaN(parsedPaidAt.getTime())) {
      return NextResponse.json({ error: "Data de recebimento inválida." }, { status: 400 })
    }
  }

  try {
    const result = await registerContaPayment({
      appointmentId,
      amount: parsedAmount,
      paymentMethod,
      actorName,
      paidAt: parsedPaidAt,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    // O serviço canônico já recusa valores acima do saldo (EXCEEDS_PENDING).
    // Repassamos o código para a UI distinguir "dado inválido" de "falha".
    if (error instanceof PaymentError) {
      const status =
        error.code === "APPOINTMENT_NOT_FOUND"
          ? 404
          : error.code === "INVALID_AMOUNT" || error.code === "INVALID_METHOD"
            ? 400
            : error.code === "EXCEEDS_PENDING"
              ? 409
              : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }

    console.error("Erro ao registrar recebimento de conta:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

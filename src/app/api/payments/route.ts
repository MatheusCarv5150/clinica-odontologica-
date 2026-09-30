import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { syncIncomeFromPayment } from "@/lib/financial-service"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { appointmentId, amount, paymentMethod } = body

    if (!appointmentId || !amount || !paymentMethod) {
      return NextResponse.json(
        { error: "Dados incompletos para pagamento" },
        { status: 400 }
      )
    }

    // O pagamento só pode existir dentro de um atendimento existente.
    // A verificação acontece ANTES de gravar para não criar registro órfão
    // nem movimentação financeira sem contexto.
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true },
    })
    if (!appointment) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    // Criar pagamento e atualizar status do agendamento
    const [payment] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          appointmentId,
          amount,
          paymentMethod,
          status: "paid",
          paidAt: new Date(),
        },
      }),
      prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: "paid" },
      }),
    ])

    // FINANCEIRO (Financeiro 1): o pagamento é a FONTE da receita. A visão
    // consolidada do fluxo é DERIVADA dele — o pagamento NÃO é duplicado.
    // A falha aqui não invalida o pagamento já gravado: o Financeiro pode ser
    // ressincronizado depois por POST /api/financial/sync-income.
    try {
      await syncIncomeFromPayment(payment.id)
    } catch (syncError) {
      console.error("Erro ao consolidar receita do pagamento:", syncError)
    }

    return NextResponse.json(payment, { status: 201 })
  } catch (error) {
    console.error("Erro ao registrar pagamento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const appointmentId = searchParams.get("appointmentId")

    const where: Record<string, unknown> = {}
    if (appointmentId) {
      where.appointmentId = appointmentId
    }

    const payments = await prisma.payment.findMany({
      where,
      include: {
        appointment: {
          include: { patient: true },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(payments)
  } catch (error) {
    console.error("Erro ao listar pagamentos:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
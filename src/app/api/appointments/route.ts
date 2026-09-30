import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { appointmentSchema } from "@/lib/schemas"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = appointmentSchema.parse(body)

    // Criar o agendamento com procedimentos e pagamento
    const appointment = await prisma.appointment.create({
      data: {
        patientId: validated.patientId,
        appointmentDate: new Date(validated.appointmentDate),
        appointmentTime: validated.appointmentTime,
        status: validated.payment.isPaid ? "paid" : "awaiting_payment",
        totalAmount: validated.procedures.reduce(
          (sum, p) => sum + p.unitPrice * p.quantity,
          0
        ),
        procedures: {
          create: validated.procedures.map((p) => ({
            procedureId: p.procedureId,
            procedureNameSnapshot: p.procedureName,
            unitPrice: p.unitPrice,
            quantity: p.quantity,
            totalPrice: p.unitPrice * p.quantity,
          })),
        },
        payments: {
          create: {
            amount: validated.procedures.reduce(
              (sum, p) => sum + p.unitPrice * p.quantity,
              0
            ),
            paymentMethod: validated.payment.paymentMethod,
            status: validated.payment.isPaid ? "paid" : "pending",
            paidAt: validated.payment.isPaid ? new Date() : null,
          },
        },
      },
      include: {
        patient: true,
        procedures: true,
        payments: true,
      },
    })

    return NextResponse.json(appointment, { status: 201 })
  } catch (error) {
    if (error instanceof Error && "issues" in error) {
      const zodError = error as { issues: Array<{ message: string }> }
      return NextResponse.json(
        { error: "Dados inválidos", details: zodError.issues },
        { status: 400 }
      )
    }
    console.error("Erro ao criar agendamento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get("date")
    const start = searchParams.get("start")
    const end = searchParams.get("end")
    const status = searchParams.get("status")

    const where: Record<string, unknown> = {}

    if (start && end) {
      // Intervalo (semana / mês): start e end são datas inclusivas (YYYY-MM-DD)
      const startDate = new Date(start)
      startDate.setHours(0, 0, 0, 0)
      const endDate = new Date(end)
      endDate.setHours(23, 59, 59, 999)

      where.appointmentDate = {
        gte: startDate,
        lte: endDate,
      }
    } else if (date) {
      const startDate = new Date(date)
      startDate.setHours(0, 0, 0, 0)
      const endDate = new Date(date)
      endDate.setHours(23, 59, 59, 999)

      where.appointmentDate = {
        gte: startDate,
        lte: endDate,
      }
    }

    if (status) {
      where.status = status
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        patient: true,
        procedures: true,
        payments: true,
      },
      orderBy: [
        { appointmentDate: "asc" },
        { appointmentTime: "asc" },
      ],
    })

    return NextResponse.json(appointments)
  } catch (error) {
    console.error("Erro ao listar agendamentos:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
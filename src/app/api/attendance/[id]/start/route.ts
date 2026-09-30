import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { STARTABLE_STATUSES } from "@/lib/schemas"

// PATCH /api/attendance/[id]/start
// Inicia o atendimento de um agendamento liberado.
//
// A validação acontece inteiramente no backend (e no banco), garantindo que
// dois profissionais não iniciem o mesmo atendimento simultaneamente:
// o updateMany com filtro de status é atômico — apenas a primeira requisição
// encontra o registro no status liberado.
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true } },
      },
    })

    if (!appointment) {
      return NextResponse.json(
        { error: "Agendamento não encontrado." },
        { status: 404 }
      )
    }

    if (appointment.status === "cancelled") {
      return NextResponse.json(
        { error: "Este agendamento está cancelado e não pode ser iniciado." },
        { status: 409 }
      )
    }

    if (appointment.status === "no_show") {
      return NextResponse.json(
        { error: "Este paciente foi marcado como não compareceu ao agendamento." },
        { status: 409 }
      )
    }

    if (appointment.status === "in_progress") {
      return NextResponse.json(
        {
          error: "Este atendimento já foi iniciado.",
          code: "ALREADY_STARTED",
          appointmentId: appointment.id,
        },
        { status: 409 }
      )
    }

    if (appointment.status === "completed") {
      return NextResponse.json(
        { error: "Este atendimento já foi concluído." },
        { status: 409 }
      )
    }

    if (!(STARTABLE_STATUSES as readonly string[]).includes(appointment.status)) {
      return NextResponse.json(
        {
          error:
            "Este paciente ainda não está liberado para atendimento. Confirme o pagamento na Agenda.",
          code: "NOT_RELEASED",
        },
        { status: 409 }
      )
    }

    // Atualização condicional e atômica: só altera se o status ainda estiver
    // liberado. count === 0 significa que outro usuário iniciou antes.
    // O horário de início é registrado AQUI, pelo backend (started_at): o
    // frontend nunca informa o horário (Parte 9 depende deste timestamp para
    // derivar a duração do atendimento).
    const result = await prisma.appointment.updateMany({
      where: { id, status: { in: [...STARTABLE_STATUSES] } },
      data: { status: "in_progress", startedAt: new Date() },
    })

    if (result.count === 0) {
      return NextResponse.json(
        {
          error:
            "Este atendimento já foi iniciado por outro usuário. Recarregue a fila para ver o status atualizado.",
          code: "ALREADY_STARTED",
        },
        { status: 409 }
      )
    }

    const updated = await prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true } },
        procedures: { select: { id: true, procedureNameSnapshot: true } },
      },
    })

    return NextResponse.json({
      success: true,
      appointment: updated,
      // A data de início é registrada pelo updatedAt do próprio agendamento.
      startedAt: updated?.updatedAt ?? new Date(),
    })
  } catch (error) {
    console.error("Erro ao iniciar atendimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

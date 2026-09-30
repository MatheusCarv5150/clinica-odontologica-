import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // ---------------------------------------------------------------------
    // Proteção do registro clínico fechado (Parte 9).
    // ---------------------------------------------------------------------
    // Um atendimento finalizado é um registro oficial do prontuário. Alterar
    // seu status de volta (ex.: "cancelled") ou reescrever dados clínicos
    // apagaria a história. A finalização só é desfeita por um mecanismo de
    // correção controlado (fora desta rota).
    const current = await prisma.appointment.findUnique({
      where: { id },
      select: { id: true, status: true, finishedAt: true },
    })

    if (!current) {
      return NextResponse.json(
        { error: "Agendamento não encontrado" },
        { status: 404 }
      )
    }

    if (current.status === "completed" || current.finishedAt) {
      return NextResponse.json(
        {
          error:
            "Este atendimento está finalizado e o registro clínico está fechado. Não é possível alterá-lo por esta via.",
          code: "ATTENDANCE_FINALIZED",
        },
        { status: 409 }
      )
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        ...(body.status && { status: body.status }),
        ...(body.appointmentDate && { appointmentDate: new Date(body.appointmentDate) }),
        ...(body.appointmentTime && { appointmentTime: body.appointmentTime }),
        ...(body.totalAmount !== undefined && { totalAmount: body.totalAmount }),
      },
      include: {
        patient: true,
        procedures: {
          include: { procedure: true },
        },
        payments: true,
      },
    })

    // Se o status for "cancelled", atualizar pagamentos também
    if (body.status === "cancelled") {
      await prisma.payment.updateMany({
        where: { appointmentId: id },
        data: { status: "refunded" },
      })
    }

    return NextResponse.json(appointment)
  } catch (error) {
    console.error("Erro ao atualizar agendamento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Verificar se o agendamento existe
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        finishedAt: true,
        evolutionRecord: { select: { id: true } },
        procedureExecutions: { select: { id: true } },
        odontogramEvents: { select: { id: true } },
      },
    })

    if (!appointment) {
      return NextResponse.json(
        { error: "Agendamento não encontrado" },
        { status: 404 }
      )
    }

    // ---------------------------------------------------------------------
    // Não apagar registros clínicos (Parte 9).
    // ---------------------------------------------------------------------
    // Um atendimento finalizado ou que já produziu conteúdo clínico (registro
    // de evolução, execuções de procedimento ou eventos do odontograma) é
    // fonte de verdade do prontuário. Não pode ser excluído: correções futuras
    // devem ser feitas por mecanismo controlado e auditado.
    const hasClinicalContent =
      !!appointment.evolutionRecord?.id ||
      appointment.procedureExecutions.length > 0 ||
      appointment.odontogramEvents.length > 0

    if (appointment.status === "completed" || appointment.finishedAt) {
      return NextResponse.json(
        {
          error:
            "Este atendimento está finalizado e não pode ser excluído. O prontuário é preservado para rastreabilidade.",
          code: "ATTENDANCE_FINALIZED",
        },
        { status: 409 }
      )
    }

    if (hasClinicalContent) {
      return NextResponse.json(
        {
          error:
            "Este atendimento possui registros clínicos e não pode ser excluído. Cancele-o para preservar a história do paciente.",
          code: "HAS_CLINICAL_CONTENT",
        },
        { status: 409 }
      )
    }

    // Deletar registros relacionados primeiro
    await prisma.payment.deleteMany({ where: { appointmentId: id } })
    await prisma.appointmentProcedure.deleteMany({ where: { appointmentId: id } })
    await prisma.appointment.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Erro ao excluir agendamento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
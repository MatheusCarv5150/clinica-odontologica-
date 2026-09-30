import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const patient = await prisma.patient.findUnique({
      where: { id },
    })

    if (!patient) {
      return NextResponse.json(
        { error: "Paciente não encontrado" },
        { status: 404 }
      )
    }

    // Buscar histórico de agendamentos
    const appointments = await prisma.appointment.findMany({
      where: { patientId: id },
      orderBy: [
        { appointmentDate: "desc" },
        { appointmentTime: "desc" },
      ],
      take: 10,
      include: {
        procedures: {
          include: {
            procedure: true,
          },
        },
        payments: true,
      },
    })

    return NextResponse.json({
      ...patient,
      appointments,
    })
  } catch (error) {
    console.error("Erro ao buscar paciente:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Se estiver alterando CPF, validar unicidade
    if (body.cpf) {
      const cleanedCPF = body.cpf.replace(/\D/g, "")
      const existing = await prisma.patient.findUnique({
        where: { cpf: cleanedCPF },
      })
      if (existing && existing.id !== id) {
        return NextResponse.json(
          { error: "CPF já cadastrado para outro paciente" },
          { status: 409 }
        )
      }
    }

    const patient = await prisma.patient.update({
      where: { id },
      data: {
        ...(body.fullName && { fullName: body.fullName }),
        ...(body.cpf && { cpf: body.cpf.replace(/\D/g, "") }),
        ...(body.phone !== undefined && {
          phone: body.phone ? body.phone.replace(/\D/g, "") : null,
        }),
        ...(body.birthDate && { birthDate: new Date(body.birthDate) }),
        ...(body.healthNotes !== undefined && { healthNotes: body.healthNotes }),
      },
    })

    return NextResponse.json(patient)
  } catch (error) {
    if (error instanceof Error && "issues" in error) {
      const zodError = error as { issues: Array<{ message: string }> }
      return NextResponse.json(
        { error: "Dados inválidos", details: zodError.issues },
        { status: 400 }
      )
    }
    console.error("Erro ao atualizar paciente:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
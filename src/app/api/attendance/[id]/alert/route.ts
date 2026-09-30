import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getClinicalAlertsForAttendance } from "@/lib/anamnesis-service"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/alert
//
// Informações importantes do paciente expostas sob demanda (o cabeçalho apenas
// sinaliza a existência; o conteúdo sensível só trafega quando solicitado):
// - Observações cadastradas no paciente (campo legado "healthNotes");
// - Alertas clínicos estruturados da ANAMNESE (alergias, condições,
//   medicamentos e respostas "Sim" relevantes).
//
// O sistema NÃO cria diagnósticos: apenas apresenta o que foi registrado.
export async function GET(
  _request: NextRequest,
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

    const appointment = await prisma.appointment.findUnique({
      where: { id },
      select: {
        patient: {
          select: {
            id: true,
            fullName: true,
            cpf: true,
            healthNotes: true,
          },
        },
      },
    })

    if (!appointment) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    const notes = appointment.patient.healthNotes?.trim() || null

    // Alertas estruturados da anamnese (mesmo paciente, resolvido no servidor).
    const structured = await getClinicalAlertsForAttendance(id)
    const clinicalAlerts = structured?.alerts ?? []

    return NextResponse.json({
      patient: {
        id: appointment.patient.id,
        fullName: appointment.patient.fullName,
        cpf: appointment.patient.cpf,
      },
      hasHealthNotes: !!notes,
      healthNotes: notes,
      // Alertas clínicos registrados na anamnese (nunca inferidos).
      alerts: clinicalAlerts,
      hasAlerts: !!notes || clinicalAlerts.length > 0,
    })
  } catch (error) {
    console.error("Erro ao carregar informações importantes do paciente:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

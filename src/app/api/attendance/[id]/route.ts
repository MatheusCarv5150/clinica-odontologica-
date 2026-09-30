import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { calculateAge, normalizeTime } from "@/lib/date-utils"
import { buildFriendlyCode } from "@/lib/attendance-status"
import {
  buildProfessionalIndex,
  resolveProfessional,
} from "@/lib/attendance-professional-resolver"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]
//
// Retorna APENAS os dados necessários para montar o cabeçalho do paciente
// durante o atendimento. Não carrega histórico clínico, procedimentos
// históricos, anexos ou dados financeiros — essas informações pertencem às
// próximas partes do prontuário.
//
// Paciente e atendimento continuam sendo entidades distintas: os dados
// permanentes vêm de Patient e o contexto do momento vem de Appointment.
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

    // Uma única consulta com os relacionamentos estritamente necessários
    // (evita N+1). Os dados do paciente são selecionados campo a campo para
    // não transportar informações clínicas além do necessário: apenas a
    // presença de observações é exposta pelo cabeçalho.
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        appointmentDate: true,
        appointmentTime: true,
        status: true,
        updatedAt: true,
        // Finalização (Parte 9): início/fim registrados pelo backend.
        startedAt: true,
        finishedAt: true,
        finishedByName: true,
        // Vínculo com o cadastro de profissionais (quando a finalização foi
        // feita por um profissional registrado). É a ponte entre o histórico
        // do atendimento e a identidade VIVA do profissional.
        finishedById: true,
        patient: {
          select: {
            id: true,
            fullName: true,
            cpf: true,
            phone: true,
            birthDate: true,
            healthNotes: true,
          },
        },
        procedures: {
          select: {
            id: true,
            procedureNameSnapshot: true,
            quantity: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    if (!appointment) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    const hasHealthNotes = !!appointment.patient.healthNotes?.trim()

    // Identidade do profissional responsável. Vive em um módulo próprio
    // (`attendance-professional-resolver`) porque o histórico usa EXATAMENTE a
    // mesma regra: vínculo por id tem precedência; atendimentos legados caem
    // no casamento pelo nome congelado; sem correspondência, o consumidor
    // exibe apenas a identidade textual do snapshot.
    const professionalIndex = await buildProfessionalIndex([appointment])
    const professional = resolveProfessional(professionalIndex, appointment)

    return NextResponse.json({
      attendance: {
        id: appointment.id,
        // Identificador amigável derivado do registro real (sem expor o
        // cuid técnico do banco de forma crua na interface).
        code: buildFriendlyCode(appointment.id),
        date: appointment.appointmentDate,
        time: normalizeTime(appointment.appointmentTime),
        status: appointment.status,
        // updatedAt representa o início do atendimento (o status só passa a
        // "in_progress" via PATCH /api/attendance/[id]/start).
        startedAt: appointment.updatedAt,
        // Finalização formal (Parte 9). O início preferencial é o registrado
        // pelo backend (started_at); o fallback mantém a compatibilidade com
        // atendimentos anteriores à Parte 9.
        finishedAt: appointment.finishedAt,
        finishedByName: appointment.finishedByName,
      },
      patient: {
        id: appointment.patient.id,
        fullName: appointment.patient.fullName,
        cpf: appointment.patient.cpf,
        phone: appointment.patient.phone,
        birthDate: appointment.patient.birthDate,
        age: calculateAge(appointment.patient.birthDate),
        // O conteúdo das observações só é exposto pelo endpoint de alerta,
        // mantendo o cabeçalho leve e o dado sensível sob demanda.
        hasHealthNotes,
      },
      procedures: appointment.procedures.map((p) => ({
        id: p.id,
        name: p.procedureNameSnapshot,
        quantity: p.quantity,
      })),
      // Profissional responsável pelo atendimento. Quando ausente (atendimentos
      // ainda não vinculados a um cadastro), o cabeçalho simplesmente não
      // exibe o bloco e a finalização usa a identidade textual.
      professional,
    })
  } catch (error) {
    console.error("Erro ao carregar cabeçalho do atendimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

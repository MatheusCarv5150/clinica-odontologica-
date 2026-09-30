import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { normalizeTime } from "@/lib/date-utils"

export const dynamic = "force-dynamic"

// GET /api/attendance/[id]/history/[recordId]
//
// Detalhes de UM atendimento anterior pertencente ao histórico do paciente do
// atendimento atual.
//
// Segurança (teste 12/14):
// - O registro solicitado só é devolvido se pertencer ao MESMO paciente do
//   atendimento informado em [id]. Um pedido com o id de outro paciente
//   resulta em 404 — o backend impede o acesso indevido mesmo trocando IDs.
// - O backend nunca confia no frontend para o isolamento entre pacientes.
//
// Integridade histórica:
// - Nome e valor do procedimento vêm do SNAPSHOT do atendimento. Alterações
//   futuras no catálogo de procedures não afetam este registro.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> }
) {
  try {
    const { id, recordId } = await params

    if (!id || !recordId) {
      return NextResponse.json(
        { error: "Identificador do atendimento não informado." },
        { status: 400 }
      )
    }

    // 1) Resolver o paciente a partir do atendimento atual.
    const current = await prisma.appointment.findUnique({
      where: { id },
      select: { patientId: true },
    })

    if (!current) {
      return NextResponse.json(
        { error: "Atendimento não encontrado." },
        { status: 404 }
      )
    }

    // 2) Buscar o registro exigindo o mesmo paciente. A cláusula pacienteId é
    //    o que garante o isolamento — nunca exposta ao cliente.
    const record = await prisma.appointment.findFirst({
      where: { id: recordId, patientId: current.patientId },
      select: {
        id: true,
        patientId: true,
        appointmentDate: true,
        appointmentTime: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        notes: true,
        patient: {
          select: {
            id: true,
            fullName: true,
            cpf: true,
            birthDate: true,
          },
        },
        procedures: {
          select: {
            id: true,
            procedureNameSnapshot: true,
            unitPrice: true,
            quantity: true,
            totalPrice: true,
          },
          orderBy: { createdAt: "asc" },
        },
        evolutionRecord: {
          select: {
            id: true,
            chiefComplaint: true,
            clinicalFindings: true,
            evaluation: true,
            conduct: true,
            evolution: true,
            guidance: true,
            intercurrentHas: true,
            intercurrentDesc: true,
            observations: true,
            finalized: true,
            finalizedAt: true,
            finalizedByName: true,
            createdById: true,
            createdByName: true,
            createdAt: true,
            updatedAt: true,
            procedureRecords: {
              select: {
                id: true,
                procedureId: true,
                procedureNameSnapshot: true,
                toothNumber: true,
                dentition: true,
                surfaces: true,
                status: true,
                material: true,
                notes: true,
                professionalName: true,
                occurredAt: true,
              },
              orderBy: { occurredAt: "asc" },
            },
          },
        },
      },
    })

    if (!record) {
      // Não distinguimos "não existe" de "não pertence a este paciente" para
      // não vazar a existência de registros de terceiros.
      return NextResponse.json(
        { error: "Atendimento não encontrado no histórico deste paciente." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      record: {
        id: record.id,
        date: record.appointmentDate,
        time: normalizeTime(record.appointmentTime),
        status: record.status,
        totalAmount: record.totalAmount,
        createdAt: record.createdAt,
        procedures: record.procedures.map((p) => ({
          id: p.id,
          name: p.procedureNameSnapshot,
          unitPrice: p.unitPrice,
          quantity: p.quantity,
          totalPrice: p.totalPrice,
        })),
        // Estruturas prontas para as próximas partes (não inventadas agora).
        professional: null,
        // Observação do atendimento e evolução clínica — conceitos separados.
        notes: record.notes,
        evolution: record.evolutionRecord,
      },
    })
  } catch (error) {
    console.error("Erro ao carregar detalhes do atendimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

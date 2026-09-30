import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const updateData: Record<string, unknown> = {}
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.evolution !== undefined) updateData.evolutionRecord = body.evolution

    const appointment = await prisma.appointment.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        notes: true,
        evolutionRecord: true,
      },
    })

    return NextResponse.json(appointment)
  } catch (error) {
    console.error("Erro ao atualizar notas/evolução do atendimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

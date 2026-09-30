import { NextRequest, NextResponse } from "next/server"
import { updatePrescription } from "@/lib/prescription-service"
import { updatePrescriptionSchema } from "@/lib/schemas-prescription"

export const dynamic = "force-dynamic"

// PATCH /api/attendance/[id]/prescriptions/[prescriptionId]
//
// Atualiza uma prescrição em RASCUNHO. Uma prescrição emitida não pode ser
// reescrita: para alterá-la, cancele e emita uma nova (histórico preservado).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; prescriptionId: string }> }
) {
  try {
    const { id, prescriptionId } = await params
    if (!id || !prescriptionId) {
      return NextResponse.json(
        { error: "Identificadores não informados." },
        { status: 400 }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Corpo da requisição inválido." },
        { status: 400 }
      )
    }

    const parsed = updatePrescriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Dados inválidos.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      )
    }

    const result = await updatePrescription(id, prescriptionId, parsed.data)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao atualizar prescrição:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

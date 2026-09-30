import { NextRequest, NextResponse } from "next/server"
import { cancelPrescription } from "@/lib/prescription-service"
import { cancelPrescriptionSchema } from "@/lib/schemas-prescription"

export const dynamic = "force-dynamic"

// POST /api/attendance/[id]/prescriptions/[prescriptionId]/cancel
//
// Cancela uma prescrição SEM apagá-la: data, autor e motivo são registrados e
// o documento original permanece preservado no prontuário.
export async function POST(
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

    const parsed = cancelPrescriptionSchema.safeParse(body)
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

    const result = await cancelPrescription(id, prescriptionId, parsed.data)

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao cancelar prescrição:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

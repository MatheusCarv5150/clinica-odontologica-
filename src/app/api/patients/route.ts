import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { patientSchema } from "@/lib/schemas"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = patientSchema.parse(body)

    // Verificar se CPF já existe
    const existing = await prisma.patient.findUnique({
      where: { cpf: validated.cpf.replace(/\D/g, "") },
    })

    if (existing) {
      return NextResponse.json(
        {
          error: "Paciente já cadastrado no sistema.",
          patient: existing,
        },
        { status: 409 }
      )
    }

    const patient = await prisma.patient.create({
      data: {
        fullName: validated.fullName,
        cpf: validated.cpf.replace(/\D/g, ""),
        phone: validated.phone ? validated.phone.replace(/\D/g, "") : null,
        birthDate: new Date(validated.birthDate),
        healthNotes: validated.healthNotes || null,
      },
    })

    return NextResponse.json(patient, { status: 201 })
  } catch (error) {
    if (error instanceof Error && "issues" in error) {
      const zodError = error as { issues: Array<{ message: string }> }
      return NextResponse.json(
        { error: "Dados inválidos", details: zodError.issues },
        { status: 400 }
      )
    }
    console.error("Erro ao criar paciente:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Use o endpoint /api/patients/search para buscar pacientes" },
    { status: 400 }
  )
}
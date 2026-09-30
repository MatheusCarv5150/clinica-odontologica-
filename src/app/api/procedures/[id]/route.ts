import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { procedureUpdateSchema, isProcedureCategory } from "@/lib/schemas"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const procedure = await prisma.procedure.findUnique({
      where: { id },
    })

    if (!procedure) {
      return NextResponse.json(
        { error: "Procedimento não encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json(procedure)
  } catch (error) {
    console.error("Erro ao buscar procedimento:", error)
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
    const validated = procedureUpdateSchema.parse(body)

    // Validar categoria
    if (!isProcedureCategory(validated.category)) {
      return NextResponse.json(
        { error: "Categoria inválida" },
        { status: 400 }
      )
    }

    // Verificar se o procedimento existe
    const existing = await prisma.procedure.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: "Procedimento não encontrado" },
        { status: 404 }
      )
    }

    // Verificar se código já existe (em outro procedimento)
    if (validated.code !== existing.code) {
      const duplicateCode = await prisma.procedure.findFirst({
        where: {
          code: validated.code,
          id: { not: id },
        },
      })

      if (duplicateCode) {
        return NextResponse.json(
          { error: `Já existe outro procedimento com o código ${validated.code}.` },
          { status: 409 }
        )
      }
    }

    // Verificar se nome já existe (em outro procedimento)
    if (validated.name !== existing.name) {
      const duplicateName = await prisma.procedure.findFirst({
        where: {
          name: validated.name,
          id: { not: id },
        },
      })

      if (duplicateName) {
        return NextResponse.json(
          { error: `Já existe outro procedimento com o nome "${validated.name}".` },
          { status: 409 }
        )
      }
    }

    const procedure = await prisma.procedure.update({
      where: { id },
      data: {
        name: validated.name,
        category: validated.category,
        code: validated.code,
        defaultPrice: validated.defaultPrice,
        allowPriceOverride: validated.allowPriceOverride,
        description: validated.description || null,
        active: validated.active,
      },
    })

    return NextResponse.json(procedure)
  } catch (error) {
    if (error instanceof Error && "issues" in error) {
      const zodError = error as { issues: Array<{ message: string }> }
      return NextResponse.json(
        { error: "Dados inválidos", details: zodError.issues },
        { status: 400 }
      )
    }
    console.error("Erro ao atualizar procedimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
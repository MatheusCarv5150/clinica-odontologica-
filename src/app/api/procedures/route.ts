import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { procedureSchema, DEFAULT_PROCEDURES, isProcedureCategory } from "@/lib/schemas"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get("q") || ""
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get("pageSize") || "20")))
    const includeInactive = searchParams.get("includeInactive") === "true"

    // Se for chamada sem query (da Agenda), retorna apenas ativos ordenados
    if (!query) {
      const procedures = await prisma.procedure.findMany({
        where: includeInactive ? {} : { active: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          category: true,
          code: true,
          defaultPrice: true,
          allowPriceOverride: true,
          description: true,
          active: true,
        },
      })

      // Se não houver procedimentos, criar os padrão
      if (procedures.length === 0) {
        const proceduresData = DEFAULT_PROCEDURES.map((p, index) => {
          const prefix = p.name.substring(0, 4).toUpperCase()
          return {
            name: p.name,
            code: `${prefix}-${String(index + 1).padStart(3, "0")}`,
            category: "Outros",
            defaultPrice: p.defaultPrice,
            active: true,
            allowPriceOverride: true,
          }
        })

        await prisma.procedure.createMany({ data: proceduresData })
        const created = await prisma.procedure.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
        })
        return NextResponse.json(created)
      }

      return NextResponse.json(procedures)
    }

    // Busca com paginação
    const searchTerm = query.trim()

    const where = {
      OR: [
        { name: { contains: searchTerm } },
        { code: { contains: searchTerm } },
      ],
      ...(includeInactive ? {} : { active: true }),
    }

    const [total, procedures] = await Promise.all([
      prisma.procedure.count({ where }),
      prisma.procedure.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          category: true,
          code: true,
          defaultPrice: true,
          allowPriceOverride: true,
          description: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ])

    return NextResponse.json({
      procedures,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (error) {
    console.error("Erro ao listar procedimentos:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = procedureSchema.parse(body)

    // Validar categoria
    if (!isProcedureCategory(validated.category)) {
      return NextResponse.json(
        { error: "Categoria inválida" },
        { status: 400 }
      )
    }

    // Verificar se código já existe
    const existingCode = await prisma.procedure.findFirst({
      where: { code: validated.code },
    })

    if (existingCode) {
      return NextResponse.json(
        { error: `Já existe um procedimento com o código ${validated.code}.` },
        { status: 409 }
      )
    }

    // Verificar se nome já existe
    const existingName = await prisma.procedure.findFirst({
      where: { name: validated.name },
    })

    if (existingName) {
      return NextResponse.json(
        { error: `Já existe um procedimento com o nome "${validated.name}".` },
        { status: 409 }
      )
    }

    const procedure = await prisma.procedure.create({
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

    return NextResponse.json(procedure, { status: 201 })
  } catch (error) {
    if (error instanceof Error && "issues" in error) {
      const zodError = error as { issues: Array<{ message: string }> }
      return NextResponse.json(
        { error: "Dados inválidos", details: zodError.issues },
        { status: 400 }
      )
    }
    console.error("Erro ao criar procedimento:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
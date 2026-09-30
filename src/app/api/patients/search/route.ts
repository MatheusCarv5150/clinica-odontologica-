import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get("q") || ""
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get("pageSize") || "20")))

    if (!query || query.trim().length < 1) {
      return NextResponse.json(
        { error: "Digite pelo menos um caractere para buscar" },
        { status: 400 }
      )
    }

    const cleanedQuery = query.trim().replace(/\D/g, "")
    const searchTerm = query.trim()

    // Construir filtro
    const where = {
      OR: [
        { fullName: { contains: searchTerm } },
        ...(cleanedQuery.length > 0
          ? [{ cpf: { contains: cleanedQuery } }]
          : []),
      ],
    }

    // Executar contagem e busca em paralelo
    const [total, patients] = await Promise.all([
      prisma.patient.count({ where }),
      prisma.patient.findMany({
        where,
        orderBy: { fullName: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fullName: true,
          cpf: true,
          phone: true,
          birthDate: true,
          healthNotes: true,
          createdAt: true,
          _count: {
            select: { appointments: true },
          },
        },
      }),
    ])

    return NextResponse.json({
      patients,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (error) {
    console.error("Erro ao buscar pacientes:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}
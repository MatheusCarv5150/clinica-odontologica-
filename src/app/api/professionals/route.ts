import { NextRequest, NextResponse } from "next/server"
import {
  createProfessional,
  listProfessionals,
  isProfessionalError,
} from "@/lib/professionals-service"

export const dynamic = "force-dynamic"

// ===========================================================================
// API DE USUÁRIOS / PROFISSIONAIS — módulo Configurações.
//
// GET  /api/professionals  -> listagem SERVER-SIDE (busca + filtros + página)
// POST /api/professionals  -> cadastro (validação autoritativa no backend)
//
// Parâmetros de GET:
//   q            busca por nome, CPF, tipo ou número de conselho
//   status       all | active | inactive   (default: all)
//   councilType  all | CRO | CRM | ...      (default: all)
//   page         1-based (default: 1)
//   pageSize     1..100 (default: 20)
//
// Nenhuma validação de frontend é confiada: o service revalida tudo.
// ===========================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const result = await listProfessionals({
      search: searchParams.get("q") ?? undefined,
      status: (searchParams.get("status") as "all" | "active" | "inactive") ?? "all",
      councilType: searchParams.get("councilType") ?? "all",
      page: Number(searchParams.get("page") ?? "1") || 1,
      pageSize: Number(searchParams.get("pageSize") ?? "20") || 20,
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error("Erro ao listar profissionais:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 })
    }

    const result = await createProfessional(
      (body ?? {}) as Parameters<typeof createProfessional>[0]
    )

    if (isProfessionalError(result)) {
      return NextResponse.json(
        { error: result.error, code: result.code, field: result.field },
        { status: result.status }
      )
    }

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar profissional:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

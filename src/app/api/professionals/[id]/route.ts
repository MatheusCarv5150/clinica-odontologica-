import { NextRequest, NextResponse } from "next/server"
import {
  deleteProfessional,
  getProfessional,
  isProfessionalError,
  setProfessionalStatus,
  updateProfessional,
} from "@/lib/professionals-service"

export const dynamic = "force-dynamic"

// ===========================================================================
// API DE USUÁRIO / PROFISSIONAL individual — módulo Configurações.
//
// GET    /api/professionals/[id]        -> detalhe
// PUT    /api/professionals/[id]        -> edição cadastral
// PATCH  /api/professionals/[id]        -> ativação/inativação ({ status })
// DELETE /api/professionals/[id]        -> exclusão SOMENTE sem histórico
//
// A edição NUNCA reescreve snapshots históricos: os atendimentos já finalizados
// continuam exibindo o nome/conselho gravados no momento do encerramento.
// ===========================================================================

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const professional = await getProfessional(id)
    if (!professional) {
      return NextResponse.json(
        { error: "Profissional não encontrado.", code: "NOT_FOUND" },
        { status: 404 }
      )
    }
    return NextResponse.json(professional, { status: 200 })
  } catch (error) {
    console.error("Erro ao buscar profissional:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 })
    }

    const result = await updateProfessional(
      id,
      (body ?? {}) as Parameters<typeof updateProfessional>[1]
    )

    if (isProfessionalError(result)) {
      return NextResponse.json(
        { error: result.error, code: result.code, field: result.field },
        { status: result.status }
      )
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error("Erro ao atualizar profissional:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    let body: { status?: string }
    try {
      body = (await request.json()) as { status?: string }
    } catch {
      return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 })
    }

    const status = body?.status
    if (status !== "active" && status !== "inactive") {
      return NextResponse.json(
        { error: "Status inválido. Use 'active' ou 'inactive'.", code: "INVALID_STATUS" },
        { status: 422 }
      )
    }

    const result = await setProfessionalStatus(id, status)
    if (isProfessionalError(result)) {
      return NextResponse.json(
        { error: result.error, code: result.code, field: result.field },
        { status: result.status }
      )
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error("Erro ao alterar status do profissional:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const result = await deleteProfessional(id)

    if (isProfessionalError(result)) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      )
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error("Erro ao excluir profissional:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

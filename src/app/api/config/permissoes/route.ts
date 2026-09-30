import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// GET /api/config/permissoes
//
// Retorna todos os perfis (roles) com suas permissões associadas.
// Usado pela tela Configurações > Permissões.
export async function GET() {
  try {
    const roles = await prisma.role.findMany({
      where: { active: true },
      include: {
        permissions: {
          include: {
            permission: true,
          },
          orderBy: {
            permission: { module: "asc" },
          },
        },
      },
      orderBy: { name: "asc" },
    })

    const formatted = roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      system: role.system,
      permissions: role.permissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        name: rp.permission.name,
        module: rp.permission.module,
        action: rp.permission.action,
      })),
    }))

    return NextResponse.json({ roles: formatted })
  } catch (error) {
    console.error("Erro ao carregar permissões:", error)
    return NextResponse.json({ error: "Erro interno." }, { status: 500 })
  }
}
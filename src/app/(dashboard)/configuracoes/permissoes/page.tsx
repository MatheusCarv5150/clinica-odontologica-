"use client"

// ===========================================================================
// PERMISSÕES — Configuração do OdontoCare
// ===========================================================================
//
// Gerencia os perfis de acesso (Roles) e as permissões atômicas associadas
// a cada perfil. Interface de leitura/consulta inicial: exibe os perfis
// existentes e suas permissões.
// ===========================================================================

import { useCallback, useEffect, useState } from "react"
import {
  ShieldCheck,
  Loader2,
  Users,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface PermissionInfo {
  id: string
  code: string
  name: string
  module: string
  action: string
}

interface RoleInfo {
  id: string
  name: string
  description: string | null
  system: boolean
  permissions: PermissionInfo[]
}

export default function PermissoesPage() {
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadRoles = useCallback(async () => {
    // O primeiro setState precisa ocorrer DEPOIS de um ponto de suspensão:
    // a regra `react-hooks/set-state-in-effect` proíbe setState síncrono no
    // corpo de um efeito (cascata de renders).
    await Promise.resolve()
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/config/permissoes")
      if (res.ok) {
        const data = await res.json()
        setRoles(data.roles ?? [])
      } else {
        const data = await res.json()
        setError(data?.error || "Erro ao carregar permissões.")
      }
    } catch {
      setError("Erro de conexão.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // A chamada é adiada para fora do corpo síncrono do efeito: a regra
    // `react-hooks/set-state-in-effect` proíbe que o efeito provoque setState
    // de forma síncrona (cascata de renders).
    const timer = setTimeout(() => void loadRoles(), 0)
    return () => clearTimeout(timer)
  }, [loadRoles])

  // Agrupa permissões por módulo
  const groupByModule = (permissions: PermissionInfo[]) => {
    const groups: Record<string, PermissionInfo[]> = {}
    for (const perm of permissions) {
      if (!groups[perm.module]) groups[perm.module] = []
      groups[perm.module].push(perm)
    }
    return groups
  }

  const actionLabel = (action: string) => {
    const map: Record<string, string> = {
      read: "Leitura",
      write: "Escrita",
      delete: "Exclusão",
      admin: "Administrar",
    }
    return map[action] || action
  }

  const actionColor = (
    action: string
  ): "default" | "success" | "warning" | "danger" | "info" => {
    const map: Record<
      string,
      "default" | "success" | "warning" | "danger" | "info"
    > = {
      read: "info",
      write: "success",
      delete: "danger",
      admin: "warning",
    }
    return map[action] || "default"
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="flex h-16 items-center gap-3 px-6">
          <ShieldCheck className="h-5 w-5 text-gray-500" />
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Permissões</h1>
            <p className="text-xs text-gray-500">
              Perfis de acesso e permissões por módulo do sistema.
            </p>
          </div>
        </div>
      </header>

      <main className="space-y-6 p-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {roles.length === 0 && !error && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Users className="h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">
                Nenhum perfil de acesso encontrado.
              </p>
              <p className="text-xs text-gray-400">
                Os perfis serão criados automaticamente pelo seed do sistema.
              </p>
            </CardContent>
          </Card>
        )}

        {roles.map((role) => {
          const grouped = groupByModule(role.permissions)
          const modules = Object.keys(grouped).sort()

          return (
            <Card key={role.id}>
              <CardContent className="p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      {role.name}
                    </h2>
                    {role.description && (
                      <p className="text-sm text-gray-500">
                        {role.description}
                      </p>
                    )}
                  </div>
                  {role.system && (
                    <Badge variant="info" className="ml-auto">
                      Sistema
                    </Badge>
                  )}
                </div>

                <div className="space-y-4">
                  {modules.map((module) => (
                    <div key={module}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                        {module}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {grouped[module].map((perm) => (
                          <Badge
                            key={perm.id}
                            variant={actionColor(perm.action)}
                          >
                            {perm.name || perm.code}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </main>
    </>
  )
}
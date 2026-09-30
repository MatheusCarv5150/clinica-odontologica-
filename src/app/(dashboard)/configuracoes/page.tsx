import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Settings, UserCog, Lock, ShieldCheck } from "lucide-react"

export const dynamic = "force-dynamic"

// ===========================================================================
// CONFIGURAÇÕES — hub da área de configuração do OdontoCare.
//
// O primeiro recurso real é "Usuários e Profissionais" (identidade
// profissional). Os demais cartões são ÂNCORAS ARQUITETURAIS para as etapas
// futuras (autenticação/login/RBAC) e não representam funcionalidade ativa.
// ===========================================================================

const resources = [
  {
    href: "/configuracoes/usuarios",
    label: "Usuários e Profissionais",
    description:
      "Gerencie os profissionais cadastrados e suas informações de identificação.",
    icon: UserCog,
    available: true,
  },
  {
    href: "/configuracoes/autenticacao",
    label: "Autenticação e Acesso",
    description:
      "Login, senha e sessões. Gerencie credenciais e defina quem acessa o sistema.",
    icon: Lock,
    available: true,
  },
  {
    href: "/configuracoes/permissoes",
    label: "Permissões",
    description:
      "Perfis de acesso por módulo do sistema. Controle granular de funcionalidades.",
    icon: ShieldCheck,
    available: true,
  },
]

export default function ConfiguracoesPage() {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="flex h-16 items-center gap-3 px-6">
          <Settings className="h-5 w-5 text-gray-500" />
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Configurações</h1>
            <p className="text-xs text-gray-500">
              Cadastros de apoio e preparação para autenticação futura.
            </p>
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((resource) => {
            const Icon = resource.icon
            const card = (
              <Card
                className={
                  resource.available
                    ? "h-full transition-colors hover:border-blue-200 hover:bg-blue-50/50"
                    : "h-full opacity-60"
                }
              >
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-center gap-3">
                    <div
                      className={
                        resource.available
                          ? "flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700"
                          : "flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-400"
                      }
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="font-medium text-gray-900">{resource.label}</p>
                    {!resource.available && (
                      <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
                        Breve
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">{resource.description}</p>
                </CardContent>
              </Card>
            )

            return resource.href ? (
              <Link key={resource.label} href={resource.href} className="block">
                {card}
              </Link>
            ) : (
              <div key={resource.label}>{card}</div>
            )
          })}
        </div>
      </main>
    </>
  )
}

"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useSidebarState } from "@/components/layout/sidebar-state"
import { LogoFull, LogoIcon } from "@/components/common/logo"
import {
  Calendar,
  Users,
  Syringe,
  Stethoscope,
  DollarSign,
  Receipt,
  Wallet,
  ArrowDownCircle,
  Activity,
  BarChart3,
  Settings,
  UserCog,
  Lock,
  ShieldCheck,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

const menuItems = [
  { href: "/agenda", label: "Agenda", icon: Calendar, enabled: true },
  { href: "/pacientes", label: "Pacientes", icon: Users, enabled: true },
  { href: "/procedimentos", label: "Procedimentos", icon: Syringe, enabled: true },
  { href: "/atendimento", label: "Atendimento", icon: Stethoscope, enabled: true },
  { href: "/financeiro", label: "Financeiro", icon: DollarSign, enabled: true },
  { href: "/financeiro/receitas", label: "Receitas", icon: Receipt, enabled: true },
  { href: "/financeiro/contas-receber", label: "Contas a Receber", icon: Wallet, enabled: true },
  { href: "/financeiro/despesas", label: "Despesas", icon: ArrowDownCircle, enabled: true },
  { href: "/financeiro/fluxo-de-caixa", label: "Fluxo de Caixa", icon: Activity, enabled: true },
  { href: "/financeiro/relatorios", label: "Relatórios", icon: BarChart3, enabled: true },
]

const settingsItems = [
  {
    href: "/configuracoes",
    label: "Configurações",
    icon: Settings,
    exact: true,
  },
  {
    href: "/configuracoes/usuarios",
    label: "Usuários e Profissionais",
    icon: UserCog,
    exact: false,
  },
  {
    href: "/configuracoes/autenticacao",
    label: "Autenticação e Acesso",
    icon: Lock,
    exact: false,
  },
  {
    href: "/configuracoes/permissoes",
    label: "Permissões",
    icon: ShieldCheck,
    exact: false,
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { collapsed, toggle } = useSidebarState()

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-gray-200 bg-white transition-all duration-300",
        collapsed ? "w-20" : "w-64"
      )}
    >
      {/* Topo: logo oficial + botão de recolher */}
      <div
        className={cn(
          "relative flex h-16 items-center border-b border-gray-200",
          collapsed ? "justify-center px-2" : "gap-3 px-6"
        )}
      >
        {collapsed ? (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-md shadow-blue-600/20 text-white"
            title="OdontoCare"
          >
            <LogoIcon size={22} />
          </div>
        ) : (
          <div className="overflow-hidden">
            <LogoFull size="sm" />
          </div>
        )}

        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          className="absolute -right-3 top-5 flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Navegação */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {!collapsed && (
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Módulos
          </p>
        )}
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href

          if (!item.enabled) {
            return (
              <div
                key={item.label}
                className={cn(
                  "flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-300",
                  collapsed && "justify-center px-2"
                )}
                title={collapsed ? `${item.label} (em breve)` : "Em breve"}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
                {!collapsed && (
                  <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
                    Breve
                  </span>
                )}
              </div>
            )
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                collapsed && "justify-center px-2"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Configurações */}
      <div className="border-t border-gray-200 px-3 py-4">
        {!collapsed && (
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Configurações
          </p>
        )}
        {settingsItems.map((item) => {
          const Icon = item.icon
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              key={item.label}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                collapsed && "justify-center px-2"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}

        {/* Separador */}
        <div className="my-2 border-t border-gray-100" />

        {/* Sair do Sistema — logout funcional */}
        <LogoutButton collapsed={collapsed} />
      </div>

      {/* Rodapé */}
      {!collapsed && (
        <div className="border-t border-gray-200 px-6 py-4">
          <p className="text-[11px] text-gray-400">
            OdontoCare v1.0
          </p>
        </div>
      )}
    </aside>
  )
}

function LogoutButton({ collapsed }: { collapsed: boolean }) {
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = useCallback(async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch {
      // Continua mesmo com erro na requisição
    }
    window.location.href = "/login"
  }, [loggingOut])

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loggingOut}
      title={collapsed ? "Sair do Sistema" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        collapsed && "justify-center px-2",
        loggingOut
          ? "text-gray-300 cursor-not-allowed"
          : "text-gray-600 hover:bg-red-50 hover:text-red-700"
      )}
    >
      <LogOut className="h-5 w-5 shrink-0" />
      {!collapsed && <span>{loggingOut ? "Saindo..." : "Sair do Sistema"}</span>}
    </button>
  )
}
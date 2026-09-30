"use client"

import { Sidebar } from "@/components/layout/sidebar"
import { SidebarProvider, useSidebarState } from "@/components/layout/sidebar-state"
import { cn } from "@/lib/utils"

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarState()

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div
        className={cn(
          "flex-1 transition-[margin] duration-300",
          collapsed ? "ml-20" : "ml-64"
        )}
      >
        {children}
      </div>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <DashboardShell>{children}</DashboardShell>
    </SidebarProvider>
  )
}
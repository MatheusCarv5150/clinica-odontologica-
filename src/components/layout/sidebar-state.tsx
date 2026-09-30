"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "odontocare:sidebar-collapsed"

interface SidebarStateValue {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (value: boolean) => void
}

const SidebarStateContext = createContext<SidebarStateValue | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem(STORAGE_KEY) === "true"
  })

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(value))
    }
  }, [])

  const toggle = useCallback(() => {
    setCollapsedState((value) => {
      const next = !value
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, String(next))
      }
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ collapsed, toggle, setCollapsed }),
    [collapsed, toggle, setCollapsed]
  )

  return (
    <SidebarStateContext.Provider value={value}>
      {children}
    </SidebarStateContext.Provider>
  )
}

export function useSidebarState() {
  const context = useContext(SidebarStateContext)
  if (!context) {
    throw new Error("useSidebarState deve ser usado dentro de <SidebarProvider>")
  }
  return context
}

/** Largura do sidebar conforme estado, usada para alinhar o conteúdo interno. */
export function sidebarOffsetClass(collapsed: boolean) {
  return cn("transition-[margin] duration-300", collapsed ? "ml-20" : "ml-64")
}

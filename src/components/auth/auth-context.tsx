"use client"

// ===========================================================================
// CONTEXTO DE AUTENTICAÇÃO — OdontoCare
// ===========================================================================
//
// Provê o usuário autenticado para componentes client-side.
// Carrega os dados via /api/auth/me no mount e os expõe via hook useAuth().
// ===========================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

export interface AuthUserClient {
  id: string
  username: string
  role: string
  professionalId: string | null
  professionalName: string | null
  professionalCouncil: string | null
}

interface AuthContextValue {
  user: AuthUserClient | null
  isLoading: boolean
  isAuthenticated: boolean
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUserClient | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    // O primeiro setState precisa ocorrer DEPOIS de um ponto de suspensão:
    // a regra `react-hooks/set-state-in-effect` proíbe setState síncrono no
    // corpo de um efeito.
    await Promise.resolve()
    try {
      const res = await fetch("/api/auth/me")
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // A chamada é adiada para fora do corpo síncrono do efeito: a regra
    // `react-hooks/set-state-in-effect` proíbe que o efeito provoque setState
    // de forma síncrona (cascata de renders).
    const timer = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(timer)
  }, [refresh])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      refresh,
    }),
    [user, isLoading, refresh]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de <AuthProvider>")
  }
  return context
}
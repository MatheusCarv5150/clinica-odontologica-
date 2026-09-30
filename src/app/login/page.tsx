"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, Stethoscope } from "lucide-react"
import { LogoFull } from "@/components/common/logo"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (
            element: HTMLElement,
            options: { theme?: string; size?: string; text?: string; width?: string }
          ) => void
        }
      }
    }
  }
}

// ===========================================================================
// Formulário de login
// ===========================================================================
// Separado do componente de página porque usa `useSearchParams()`, que exige
// um limite de <Suspense> para o prerender estático em produção
// (ver: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout).
// ===========================================================================

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get("from") || "/agenda"

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const googleButtonRef = useRef<HTMLDivElement | null>(null)

  const handleGoogleLogin = useCallback(
    async (response: { credential: string }) => {
      if (!response?.credential) {
        setError("Não foi possível autenticar com o Google.")
        return
      }

      setIsLoading(true)
      setError("")

      try {
        const res = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: response.credential }),
        })

        const data = await res.json()

        if (!res.ok) {
          setError(data?.error || "Não foi possível entrar com o Google.")
          return
        }

        router.push(from)
        router.refresh()
      } catch {
        setError("Erro ao autenticar com o Google.")
      } finally {
        setIsLoading(false)
      }
    },
    [from, router]
  )

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
    if (!clientId || !googleButtonRef.current) return

    const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]')

    const initializeGoogleButton = () => {
      const google = window.google
      if (!google?.accounts?.id || !googleButtonRef.current) return

      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleLogin,
      })

      google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        width: "100%",
      })
    }

    if (window.google?.accounts?.id) {
      initializeGoogleButton()
      return
    }

    if (existingScript) {
      existingScript.addEventListener("load", initializeGoogleButton, { once: true })
      return
    }

    const script = document.createElement("script")
    script.src = "https://accounts.google.com/gsi/client"
    script.async = true
    script.defer = true
    script.onload = initializeGoogleButton
    document.head.appendChild(script)
  }, [handleGoogleLogin])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError("")

      if (!username.trim() || !password) {
        setError("Credenciais inválidas.")
        return
      }

      setIsLoading(true)

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.trim(), password }),
        })

        const data = await res.json()

        if (!res.ok) {
          setError(data?.error || "Credenciais inválidas.")
          return
        }

        router.push(from)
        router.refresh()
      } catch {
        setError("Erro de conexão. Tente novamente.")
      } finally {
        setIsLoading(false)
      }
    },
    [username, password, router, from]
  )

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6 py-12">
      <div className="w-full max-w-md space-y-8">
        {/* Cabeçalho / Logo Oficial */}
        <div className="flex flex-col items-center text-center">
          <LogoFull size="xl" />
          <p className="mt-3 text-base text-gray-500">
            Bem-vindo ao OdontoCare
          </p>
        </div>

        {/* Formulário de Login */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-6"
        >
          {error && (
            <div className="rounded-lg bg-red-50 p-4 border border-red-100">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="username"
                className="text-sm font-medium text-gray-700"
              >
                Usuário
              </label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="Seu usuário de acesso"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-sm font-medium text-gray-700"
              >
                Senha
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-11 text-base"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Entrando...
              </>
            ) : (
              <>
                <Stethoscope className="h-4 w-4" />
                Entrar
              </>
            )}
          </Button>

          {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID ? (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-gray-400">
                <span className="h-px flex-1 bg-gray-200" />
                <span>ou</span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>
              <div ref={googleButtonRef} className="min-h-[44px]" />
            </div>
          ) : null}
        </form>

        <p className="text-center text-xs text-gray-400">
          OdontoCare v1.0 &copy; {new Date().getFullYear()} — Todos os direitos
          reservados.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
// Envolve o formulário em <Suspense> para permitir o prerender estático de
// /login mesmo com o uso de `useSearchParams()` no formulário.
// ---------------------------------------------------------------------------
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  )
}

// Fallback exibido durante o carregamento/hidratação: mesma moldura visual,
// sem conteúdo interativo. Não altera a identidade visual da tela.
function LoginFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <LogoFull size="xl" />
          <p className="mt-3 text-base text-gray-500">
            Bem-vindo ao OdontoCare
          </p>
        </div>
        <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </div>
    </div>
  )
}

"use client"

// ===========================================================================
// AUTENTICAÇÃO E ACESSO — Configuração do OdontoCare
// ===========================================================================
//
// Gerencia feature flags de autenticação e sessão.
// Permite ativar/desativar a exigência de login, alterar TTL da sessão
// e limite de tentativas.
// ===========================================================================

import { useCallback, useEffect, useState } from "react"
import { Lock, Loader2, Save, RotateCcw } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

interface AuthConfig {
  authRequired: boolean
  sessionTtlHours: number
  maxLoginAttempts: number
}

const DEFAULTS: AuthConfig = {
  authRequired: true,
  sessionTtlHours: 8,
  maxLoginAttempts: 5,
}

export default function AutenticacaoPage() {
  const [config, setConfig] = useState<AuthConfig>(DEFAULTS)
  const [original, setOriginal] = useState<AuthConfig>(DEFAULTS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  // Carrega as configurações
  const loadConfig = useCallback(async () => {
    // O primeiro setState precisa ocorrer DEPOIS de um ponto de suspensão:
    // a regra `react-hooks/set-state-in-effect` proíbe setState síncrono no
    // corpo de um efeito (cascata de renders).
    await Promise.resolve()
    setIsLoading(true)
    try {
      const res = await fetch("/api/config/auth")
      if (res.ok) {
        const data = await res.json()
        const loaded: AuthConfig = {
          authRequired: data.authRequired ?? DEFAULTS.authRequired,
          sessionTtlHours: data.sessionTtlHours ?? DEFAULTS.sessionTtlHours,
          maxLoginAttempts: data.maxLoginAttempts ?? DEFAULTS.maxLoginAttempts,
        }
        setConfig(loaded)
        setOriginal(loaded)
      }
    } catch {
      // Mantém defaults
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // A chamada é adiada para fora do corpo síncrono do efeito: a regra
    // `react-hooks/set-state-in-effect` proíbe que o efeito provoque setState
    // de forma síncrona (cascata de renders).
    const timer = setTimeout(() => void loadConfig(), 0)
    return () => clearTimeout(timer)
  }, [loadConfig])

  const hasChanges =
    config.authRequired !== original.authRequired ||
    config.sessionTtlHours !== original.sessionTtlHours ||
    config.maxLoginAttempts !== original.maxLoginAttempts

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/config/auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setMessage({ type: "success", text: "Configurações salvas com sucesso." })
        setOriginal({ ...config })
      } else {
        const data = await res.json()
        setMessage({ type: "error", text: data?.error || "Erro ao salvar." })
      }
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." })
    } finally {
      setIsSaving(false)
    }
  }, [config])

  const handleReset = useCallback(() => {
    setConfig(DEFAULTS)
    setMessage(null)
  }, [])

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
          <Lock className="h-5 w-5 text-gray-500" />
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              Autenticação e Acesso
            </h1>
            <p className="text-xs text-gray-500">
              Controle de login, sessão e tentativas de acesso.
            </p>
          </div>
        </div>
      </header>

      <main className="space-y-6 p-6">
        {message && (
          <div
            className={`rounded-lg border p-4 text-sm ${
              message.type === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {message.text}
          </div>
        )}

        <Card>
          <CardContent className="space-y-6 p-6">
            {/* Auth Required */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="authRequired">Exigir autenticação</Label>
                <p className="text-sm text-gray-500">
                  Quando ativo, todos os usuários precisam fazer login para
                  acessar o sistema.
                </p>
              </div>
              <Switch
                id="authRequired"
                checked={config.authRequired}
                onCheckedChange={(checked) =>
                  setConfig((prev) => ({ ...prev, authRequired: checked }))
                }
              />
            </div>

            <hr className="border-gray-200" />

            {/* Session TTL */}
            <div className="space-y-2">
              <Label htmlFor="sessionTtlHours">
                Duração da sessão (horas)
              </Label>
              <p className="text-sm text-gray-500">
                Tempo máximo que uma sessão permanece ativa sem nova
                autenticação.
              </p>
              <Input
                id="sessionTtlHours"
                type="number"
                min={1}
                max={168}
                value={config.sessionTtlHours}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sessionTtlHours: Math.max(1, Number(e.target.value)),
                  }))
                }
                className="w-32"
              />
            </div>

            <hr className="border-gray-200" />

            {/* Max Login Attempts */}
            <div className="space-y-2">
              <Label htmlFor="maxLoginAttempts">
                Tentativas máximas de login
              </Label>
              <p className="text-sm text-gray-500">
                Número de tentativas permitidas antes de bloquear
                temporariamente o acesso.
              </p>
              <Input
                id="maxLoginAttempts"
                type="number"
                min={1}
                max={20}
                value={config.maxLoginAttempts}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    maxLoginAttempts: Math.max(1, Number(e.target.value)),
                  }))
                }
                className="w-32"
              />
            </div>
          </CardContent>
        </Card>

        {/* Ações */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar
          </Button>

          <Button
            variant="outline"
            onClick={handleReset}
            disabled={!hasChanges}
          >
            <RotateCcw className="h-4 w-4" />
            Resetar padrões
          </Button>
        </div>
      </main>
    </>
  )
}
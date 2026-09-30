import { prisma } from "@/lib/prisma"

// ===========================================================================
// CONFIG HUB — Feature flags do OdontoCare
// ===========================================================================
//
// Gerencia chaves de configuração do sistema (feature flags, toggles, etc)
// usando uma tabela no banco (Config). Permite ativar/desativar recursos
// sem deploy.
// ===========================================================================

export type ConfigKey =
  | "auth_required"        // Se true, login é obrigatório
  | "permissions_enabled"  // Se true, RBAC é aplicado
  | "max_login_attempts"   // Número máximo de tentativas de login
  | "session_ttl_hours"    // Duração da sessão em horas

// Valor padrão para cada chave (usado quando não existe no banco)
const DEFAULTS: Record<ConfigKey, string> = {
  auth_required: "true",
  permissions_enabled: "false",
  max_login_attempts: "5",
  session_ttl_hours: "8",
}

/**
 * Retorna o valor de uma chave de configuração.
 * Se não existir no banco, retorna o valor padrão.
 */
export async function getConfig(key: ConfigKey): Promise<string> {
  try {
    const row = await prisma.config.findUnique({ where: { key } })
    return row?.value ?? DEFAULTS[key]
  } catch {
    return DEFAULTS[key]
  }
}

/**
 * Retorna true se a chave tiver valor "true" (case-insensitive).
 */
export async function isConfigEnabled(key: ConfigKey): Promise<boolean> {
  const value = await getConfig(key)
  return value?.toLowerCase() === "true"
}

/**
 * Define o valor de uma chave de configuração.
 * Upsert: cria se não existir, atualiza se existir.
 */
export async function setConfig(key: ConfigKey, value: string): Promise<void> {
  await prisma.config.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

/**
 * Reseta uma chave para o valor padrão.
 */
export async function resetConfig(key: ConfigKey): Promise<void> {
  await setConfig(key, DEFAULTS[key])
}
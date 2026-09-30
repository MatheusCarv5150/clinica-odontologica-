#!/bin/sh
# ===========================================================================
# ENTRYPOINT DE PRODUÇÃO — OdontoCare
# ===========================================================================
#
# Responsabilidades (em ordem):
#   1. Aguardar o PostgreSQL aceitar conexões (retry com timeout).
#   2. Aplicar migrations pendentes (`prisma migrate deploy`).
#   3. Rodar o seed idempotente (roles, permissões, admin, catálogo).
#   4. Iniciar o servidor Next.js standalone.
#
# O seed é IDEMPOTENTE e NÃO DESTRUTIVO (usa upsert). Rodar a cada boot é
# seguro: ele nunca apaga dados nem sobrescreve senhas existentes.
#
# Se `RUN_SEED_ON_BOOT=false`, o passo 3 é pulado (útil para deployments
# onde o seed é aplicado manualmente uma única vez).
# ===========================================================================
set -e

echo "[entrypoint] Iniciando OdontoCare em modo produção..."

# Caminho explícito do Prisma CLI (instalado em node_modules do runner).
PRISMA_CLI="./node_modules/prisma/build/index.js"

# ---------------------------------------------------------------------------
# 1) Espera pelo banco.
# ---------------------------------------------------------------------------
# O EasyPanel pode subir o container do app antes do Postgres estar pronto.
# Tenta conectar por até ~60s antes de desistir.
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] Aguardando o banco de dados aceitar conexões..."
  ATTEMPTS=0
  MAX_ATTEMPTS=30
  until node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$queryRaw\`SELECT 1\`.then(()=>process.exit(0)).catch(()=>process.exit(1));" >/dev/null 2>&1; do
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
      echo "[entrypoint] ERRO: banco não respondeu após ${MAX_ATTEMPTS} tentativas. Abortando."
      exit 1
    fi
    echo "[entrypoint] Banco ainda não disponível (tentativa ${ATTEMPTS}/${MAX_ATTEMPTS})..."
    sleep 2
  done
  echo "[entrypoint] Banco disponível."
else
  echo "[entrypoint] AVISO: DATABASE_URL não definida. Pulando espera pelo banco."
fi

# ---------------------------------------------------------------------------
# 2) Migrations.
# ---------------------------------------------------------------------------
echo "[entrypoint] Aplicando migrations pendentes..."
node "$PRISMA_CLI" migrate deploy

# ---------------------------------------------------------------------------
# 3) Seed idempotente.
# ---------------------------------------------------------------------------
if [ "${RUN_SEED_ON_BOOT:-true}" = "true" ]; then
  echo "[entrypoint] Executando seed idempotente..."
  if node prisma/seed.production.js; then
    echo "[entrypoint] Seed concluído."
  else
    echo "[entrypoint] AVISO: seed falhou, mas isso não impede o boot. Verifique os logs."
  fi
else
  echo "[entrypoint] Seed no boot desativado (RUN_SEED_ON_BOOT=false)."
fi

# ---------------------------------------------------------------------------
# 4) Servidor.
# ---------------------------------------------------------------------------
echo "[entrypoint] Iniciando o servidor Next.js (node server.js)..."
exec node server.js

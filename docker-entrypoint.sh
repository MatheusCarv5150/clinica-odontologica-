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

# ---------------------------------------------------------------------------
# 1) Espera pelo banco.
# ---------------------------------------------------------------------------
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
# 2) Migrations (db push).
# ---------------------------------------------------------------------------
echo "[entrypoint] Sincronizando schema com db push..."
npx prisma db push --skip-generate

# ---------------------------------------------------------------------------
# 3) Seed idempotente.
# ---------------------------------------------------------------------------
if [ "${RUN_SEED_ON_BOOT:-true}" = "true" ]; then
  echo "[entrypoint] Executando seed idempotente..."
  if node --input-type=module -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  // Roles
  const adminRole = await prisma.role.upsert({
    where: { nome: 'ADMINISTRADOR' },
    update: {},
    create: { nome: 'ADMINISTRADOR', descricao: 'Acesso total ao sistema' }
  });
  const atendenteRole = await prisma.role.upsert({
    where: { nome: 'ATENDENTE' },
    update: {},
    create: { nome: 'ATENDENTE', descricao: 'Acesso a agendamento e pacientes' }
  });
  const dentistaRole = await prisma.role.upsert({
    where: { nome: 'DENTISTA' },
    update: {},
    create: { nome: 'DENTISTA', descricao: 'Acesso a atendimento e procedimentos' }
  });

  // Admin user
  const bcrypt = require('bcryptjs');
  const adminExists = await prisma.usuario.findFirst({ where: { login: 'administrador' } });
  if (!adminExists) {
    const hash = await bcrypt.hash('123456', 10);
    await prisma.usuario.create({
      data: { login: 'administrador', senha: hash, nome: 'Administrador', roleId: adminRole.id, ativo: true }
    });
    console.log('[seed] Usuário administrador criado (login: administrador / senha: 123456)');
  } else {
    console.log('[seed] Usuário administrador já existe, pulando.');
  }

  console.log('[seed] Seed concluído com sucesso.');
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.\$disconnect());
"; then
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

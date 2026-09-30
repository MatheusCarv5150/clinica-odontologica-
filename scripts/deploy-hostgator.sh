#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Arquivo .env não encontrado. Configure as variáveis de produção antes de continuar."
  exit 1
fi

export NODE_ENV=production

npm install
npx prisma generate
npx prisma migrate deploy
npm run build

PORT="${PORT:-3000}"
HOSTNAME="${HOSTNAME:-0.0.0.0}"

echo "Iniciando app em produção em http://$HOSTNAME:$PORT"
PORT="$PORT" HOSTNAME="$HOSTNAME" npm run start

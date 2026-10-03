# ===========================================================================
# ODONTOCARE — DOCKERFILE DE PRODUÇÃO (Next.js 16 + Prisma)
# ===========================================================================
#
# Multi-stage build:
#   deps    -> instala somente as dependências necessárias (com dev deps p/ build)
#   builder -> gera o Prisma Client e compila o Next em modo produção
#   runner  -> imagem final enxuta, apenas dependências de produção + build
#
# Regras respeitadas:
#   - NÃO roda `npm run dev` (o processo principal é `next start`).
#   - NÃO embute credenciais (tudo vem de variáveis de ambiente em runtime).
#   - NÃO depende do ambiente local (Windows) nem de caminhos absolutos.
#   - O cliente Prisma é gerado DENTRO da imagem (Linux), não copiado do host.
#
# Build:
#   docker build -t odontocare:latest .
# Run (exemplo):
#   docker run --rm -p 3000:3000 \
#     -e DATABASE_URL="postgresql://..." \
#     -e AUTH_SECRET="..." \
#     -v odontocare_storage:/data/storage \
#     odontocare:latest
# ===========================================================================

# ---------------------------------------------------------------------------
# Stage 1 — deps: dependências (inclui devDependencies, necessárias ao build)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# openssl é exigido pelos engines do Prisma.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copia apenas os manifestos para aproveitar o cache de camadas.
COPY package.json package-lock.json ./
COPY prisma ./prisma

# `npm ci` respeita o lockfile (build reprodutível).
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2 — builder: gera o Prisma Client e compila o Next.js
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# O Prisma Client precisa ser gerado no momento do build (Linux), pois os
# binários de engine são específicos da plataforma.
RUN npx prisma generate

# `next build` exige uma DATABASE_URL válida em tempo de build apenas para
# instanciar o client — não é feita nenhuma conexão real nesta etapa.
ENV DATABASE_URL="file:./build-placeholder.db"
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3 — runner: imagem final de produção
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Diretório padrão do volume persistente de arquivos clínicos.
ENV STORAGE_PATH=/data/storage

# Usuário sem privilégios.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Servidor standalone gerado pelo `next build` (output: "standalone").
# Inclui apenas o necessário para rodar: node_modules mínimos + server.js.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma: schema, migrations e client gerado (necessários em runtime para
# `prisma migrate deploy` e para o engine do client).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Prisma CLI + engines: necessários em RUNTIME para rodar `prisma migrate
# deploy` no boot. O servidor standalone do Next não inclui o binário do
# Prisma, então trazemos explicitamente do builder.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma/engines ./node_modules/@prisma/engines

# bcryptjs: necessário para o seed inline (hash de senha).
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

# .bin com links simbólicos para npx encontrar os binários
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin

# Script de entrada: espera o banco, aplica migrations, roda seed e sobe o app.
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Diretório de storage (será sobrescrito pelo volume em runtime).
RUN mkdir -p /data/storage && chown -R nextjs:nodejs /data /app

USER nextjs

EXPOSE 3000

# Health check — usado pelo Docker/EasyPanel para saber se o app está vivo.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# Processo de PRODUÇÃO (nunca `next dev`). O entrypoint aplica migrations e
# seed antes de iniciar o server.js gerado pelo standalone.
CMD ["./docker-entrypoint.sh"]

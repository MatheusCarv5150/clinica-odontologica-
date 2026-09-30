# Deploy no HostGator / VPS

## 1) Requisitos

- Node.js 20+
- npm
- PostgreSQL 14+ (ou banco externo compatível)
- domínio apontado para o servidor
- arquivo `.env` com variáveis de produção

## 2) Variáveis de ambiente

Crie um arquivo `.env.production` (ou configure as variáveis no painel do host):

```env
DATABASE_URL="postgresql://usuario:senha@host:5432/clinica?schema=public"
AUTH_SECRET="gere_uma_string_forte_e_aleatoria"
NEXT_PUBLIC_APP_URL="https://seu-dominio.com"
NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
PORT=3000
NODE_ENV=production
STORAGE_PATH="/data/storage"
```

> Importante: o projeto não deve usar SQLite em produção. O banco em produção deve ser PostgreSQL.

## 3) Instalar dependências

```bash
npm install
```

## 4) Gerar Prisma e aplicar migrations

```bash
npx prisma generate
npx prisma migrate deploy
```

Se necessário, rode o seed inicial:

```bash
node prisma/seed.production.js
```

## 5) Build de produção

```bash
npm run build
```

## 6) Iniciar em produção

```bash
PORT=3000 npm run start
```

Ou, em um processo de longa duração com PM2:

```bash
npm install -g pm2
pm2 start "npm run start" --name odontocare
pm2 save
```

Se o host exige bind específico:

```bash
PORT=3000 HOSTNAME=0.0.0.0 npm run start
```

## 7) Google OAuth

No Google Cloud Console:

1. Criar projeto
2. Habilitar "Google Identity Services"
3. Criar OAuth Client ID
4. Configurar Authorized JavaScript origins
   - `https://seu-dominio.com`
   - `http://localhost:3000` (somente dev)
5. Configurar Authorized redirect URIs
   - se usar frontend do Google diretamente, normalmente não é necessário para JavaScript; depende da implementação escolhida
6. Copiar valores para:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`

## 8) Se a HostGator não suportar Node

A hospedagem compartilhada da HostGator muitas vezes não resolve bem um Next.js com Prisma e banco real. Nesses casos, o ideal é:

- VPS Linux
- servidor Node dedicado
- Render / Railway / DigitalOcean / VPS

## 9) Diagnóstico rápido

Se o app não sobe:

```bash
node -v
npm -v
npx prisma validate
npm run build
```

Se der erro de `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

## 10) Comando final recomendado

```bash
npx prisma generate && npx prisma migrate deploy && npm run build && PORT=3000 HOSTNAME=0.0.0.0 npm run start
```

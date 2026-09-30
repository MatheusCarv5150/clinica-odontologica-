# Deploy no EasyPanel via GitHub — OdontoCare

Guia passo a passo para publicar o sistema da clínica usando **GitHub + EasyPanel**.
Esta é a rota recomendada: o EasyPanel constrói a imagem Docker a partir do seu
repositório e gerencia o banco PostgreSQL e os volumes pela interface.

---

## Visão geral da arquitetura

```
┌────────────┐   push    ┌──────────┐   build    ┌───────────────┐
│  Máquina   │ ────────► │  GitHub  │ ─────────► │   EasyPanel   │
│  (dev)     │           │  (repo)  │            │   (VPS)       │
└────────────┘           └──────────┘            └───────┬───────┘
                                                         │
                                    ┌────────────────────┼────────────────────┐
                                    │                    │                    │
                              ┌─────▼─────┐        ┌─────▼─────┐        ┌─────▼─────┐
                              │  App      │        │ Postgres  │        │  Volume   │
                              │ (Next.js) │        │  (dados)  │        │ (arquivos)│
                              └───────────┘        └───────────┘        └───────────┘
```

- **App**: construído a partir do `Dockerfile` do repositório.
- **Postgres**: criado como serviço no próprio EasyPanel.
- **Volume**: guarda documentos/imagens clínicas (dado sensível — LGPD).

---

## Parte 1 — Publicar o código no GitHub

### 1.1 Instalar o Git (Windows)

Baixe e instale: <https://git-scm.com/download/win>

Após instalar, **feche e reabra o VS Code** (ou o terminal) para o `git` entrar no PATH.
Confirme:

```powershell
git --version
```

### 1.2 Configurar identidade (uma vez por máquina)

```powershell
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@exemplo.com"
```

### 1.3 Inicializar o repositório

No terminal, dentro da pasta do projeto:

```powershell
git init
git add .
git commit -m "chore: prepara deploy via EasyPanel"
git branch -M main
```

> O `.gitignore` já exclui `.env`, bancos locais e a pasta `storage/`.
> **Nunca** faça commit de arquivos `.env` reais — eles contêm segredos.

### 1.4 Criar o repositório no GitHub

1. Acesse <https://github.com/new>.
2. **Repository name**: `clinica-odontologica` (ou outro nome).
3. **Visibility**: **Private** (recomendado — o projeto é de uma clínica).
4. **NÃO** marque "Add a README", ".gitignore" ou "license" (o projeto já tem).
5. Clique em **Create repository**.

### 1.5 Conectar e enviar

O GitHub mostrará os comandos. Use a versão "…or push an existing repository":

```powershell
git remote add origin https://github.com/SEU-USUARIO/clinica-odontologica.git
git push -u origin main
```

> Na primeira vez, o Git abrirá o navegador para autenticar no GitHub
> (Git Credential Manager). Faça login e autorize.

---

## Parte 2 — Preparar o PostgreSQL no EasyPanel

1. No EasyPanel, entre no **projeto** onde o app vai morar (crie um se não existir).
2. Clique em **+ Create Service** → **Database** → **PostgreSQL**.
3. Preencha:
   - **Name**: `odontocare-db`
   - **Password**: clique em gerar (guarde com segurança).
   - Versão: 16 (ou a mais recente disponível).
4. Clique em **Create**.

5. Depois de criado, abra o serviço e copie a **Internal Connection URL**
   (algo como `postgresql://postgres:SENHA@odontocare-db:5432/odontocare?schema=public`).
   Essa URL é usada **internamente** entre serviços do EasyPanel.

> Guarde essa connection string — ela vira o `DATABASE_URL` do app.
> **Não** compartilhe nem cole esse valor em chats/issues.

---

## Parte 3 — Criar o App no EasyPanel

1. No mesmo projeto: **+ Create Service** → **App**.
2. Aba **Source**:
   - **Source type**: **GitHub**
   - Conecte sua conta GitHub (o EasyPanel pede autorização; autorize o repo).
   - **Repository**: `clinica-odontologica`
   - **Branch**: `main`
3. Aba **Build**:
   - **Build type**: **Dockerfile**
   - **Dockerfile path**: `Dockerfile` (raiz)
4. Aba **Environment** — adicione as variáveis (ver Parte 4).
5. Aba **Domains**: adicione seu domínio, ex.: `clinica.seudominio.com`, com
   **HTTPS** ativado (Let's Encrypt automático).
6. **Deploy**.

---

## Parte 4 — Variáveis de ambiente

Configure **exatamente** estas chaves no serviço do app (aba Environment):

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection URL **interna** do Postgres criado na Parte 2. |
| `AUTH_SECRET` | ✅ | Segredo de sessão. Gere um forte (ver abaixo). |
| `NEXT_PUBLIC_APP_URL` | ✅ | URL pública do app, ex.: `https://clinica.seudominio.com`. |
| `STORAGE_PATH` | ✅ | `/data/storage` (deve coincidir com o volume da Parte 5). |
| `GOOGLE_CLIENT_ID` | ⬜ | Só se usar login com Google. |
| `GOOGLE_CLIENT_SECRET` | ⬜ | Só se usar login com Google. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | ⬜ | Só se usar login com Google. |
| `RUN_SEED_ON_BOOT` | ⬜ | Padrão `true`. Aplica seed (roles, admin, catálogo) a cada boot. |
| `NODE_ENV` | ⬜ | Já definido como `production` na imagem. |
| `PORT` | ⬜ | Já definido como `3000` na imagem. |

### Gerar o `AUTH_SECRET`

Em qualquer terminal com OpenSSL:

```bash
openssl rand -base64 32
```

Ou use um gerador de senha confiável e cole um valor aleatório de 32+ caracteres.

> ⚠️ **Nunca** faça commit desse valor. Ele só vive nas variáveis do EasyPanel.

---

## Parte 5 — Volume persistente (arquivos clínicos)

Documentos e imagens de pacientes **não podem** ficar no filesystem efêmero do
container (seriam perdidos a cada redeploy).

1. No serviço do app, aba **Mounts** (ou **Volumes**).
2. Adicione um **Volume**:
   - **Name**: `odontocare-storage`
   - **Mount path**: `/data/storage`
3. Salve.

Isso casa com `STORAGE_PATH=/data/storage` (já definido na imagem e nas variáveis).

---

## Parte 6 — O que acontece no boot (automático)

O container usa um **entrypoint** (`docker-entrypoint.sh`) que, a cada inicialização:

1. **Aguarda** o Postgres aceitar conexões (retry por ~60s).
2. Aplica **migrations** pendentes (`prisma migrate deploy`).
3. Roda o **seed idempotente** (`prisma/seed.production.js`): cria perfis,
   permissões, o usuário admin inicial e o catálogo de procedimentos.
   - Seguro repetir: usa `upsert`, nunca apaga nem sobrescreve senhas.
   - Para desativar: `RUN_SEED_ON_BOOT=false`.
4. Inicia o **servidor Next.js** (`node server.js`).

O **health check** (`/api/health`) informa ao EasyPanel quando o app está pronto:
- `200 {"status":"ok","database":"up"}` → tudo certo.
- `503 {"status":"degraded","database":"down"}` → app vivo, banco inacessível.

---

## Parte 7 — Primeiro acesso

Após o deploy ficar verde:

1. Acesse `https://clinica.seudominio.com/login`.
2. Credencial inicial de demonstração (criada pelo seed):
   - **usuário**: `administrador`
   - **senha**: `123456`
3. **Troque a senha imediatamente** após entrar.

---

## Parte 8 — Deploys seguintes

Fluxo normal passa a ser:

```powershell
git add .
git commit -m "feat: descrição da mudança"
git push
```

Se quiser deploy automático a cada push:

- No serviço do app, ative **Auto Deploy** (aba **Source** / **Deploy**).
- Sem auto deploy: clique em **Deploy** manualmente no painel.

Migrations novas em `prisma/migrations/` são aplicadas sozinhas no boot.

---

## Diagnóstico rápido de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| Build falha em `npm ci` | `package-lock.json` dessincronizado | Rode `npm install` local e faça commit do lock. |
| Container reinicia em loop | `AUTH_SECRET` ausente | Defina `AUTH_SECRET` nas variáveis. |
| `/api/health` retorna 503 | `DATABASE_URL` errada ou banco fora | Confira a connection string interna. |
| Erro "Cannot use import statement" | seed sem ESM | Já corrigido por `prisma/package.json` (`type: module`). |
| Tabelas não existem | migrations não aplicadas | Verifique os logs do boot (`migrate deploy`). |
| Login falha / sem acesso | seed não rodou | Confirme `RUN_SEED_ON_BOOT=true` e reinicie. |
| Arquivos somem após redeploy | volume não montado | Configure o mount em `/data/storage`. |

### Ver logs

No EasyPanel: abra o serviço do app → aba **Logs**. O entrypoint imprime cada
etapa com o prefixo `[entrypoint]`.

---

## Checklist final

- [ ] Git instalado e repositório no GitHub (privado)
- [ ] Postgres criado no EasyPanel
- [ ] App criado apontando para o repo/branch/Dockerfile
- [ ] `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, `STORAGE_PATH` definidos
- [ ] Volume montado em `/data/storage`
- [ ] Domínio com HTTPS ativo
- [ ] Deploy concluído e `/api/health` retornando 200
- [ ] Login com `administrador` funcionando
- [ ] Senha do admin alterada

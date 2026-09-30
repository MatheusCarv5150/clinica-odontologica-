// ===========================================================================
// SEED DE PRODUÇÃO — OdontoCare
// ===========================================================================
//
// Execução:
//   npx prisma db seed          (usa o bloco "prisma.seed" do package.json)
//   ou: node prisma/seed.production.js
//
// OBJETIVO
// - Criar de forma IDEMPOTENTE os dados mínimos para o sistema operar:
//     1. Perfis de acesso (roles)
//     2. Permissões atômicas
//     3. Vínculo role x permissão
//     4. Usuário administrador inicial
//     5. Catálogo de procedimentos padrão
//
// CARACTERÍSTICAS
// - IDEMPOTENTE: rodar N vezes não duplica registros (usa `upsert`).
// - NÃO DESTRUTIVO: nunca apaga dados, nunca sobrescreve senhas existentes,
//   nunca faz reset. Pode ser executado com segurança em um banco já em uso.
// - SENHA SEMPRE EM HASH: usa bcrypt (mesmo algoritmo verificado no login,
//   em src/lib/auth-service.ts). A senha em texto NÃO é armazenada.
// - NÃO retorna nem registra a senha nos logs.
//
// CREDENCIAL INICIAL DE DEMONSTRAÇÃO
//   usuário: administrador
//   senha:   123456
//   perfil:  ADMINISTRADOR
//   ativo:   true
//   sem profissional associado
//
//   ATENÇÃO: esta é uma credencial PÚBLICA de demonstração. O administrador
//   DEVE alterar a senha imediatamente após o primeiro acesso em produção.
//
// O seed NÃO cria pacientes nem profissionais de exemplo — apenas o mínimo
// necessário para operar com segurança.
// ===========================================================================

import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

// Mesmos parâmetros usados em src/lib/auth-service.ts — se divergirem, o
// login deixa de validar as senhas criadas aqui.
const BCRYPT_ROUNDS = 10

// Credencial inicial de demonstração (documentada, NÃO logada).
const INITIAL_ADMIN = {
  username: "administrador",
  password: "123456",
  role: "ADMINISTRADOR",
}

async function seedPermissionsAndRoles() {
  // --- Perfis de acesso ---
  const rolesData = [
    {
      name: "ADMINISTRADOR",
      description: "Acesso total ao sistema, incluindo configurações.",
    },
    {
      name: "DENTISTA",
      description: "Acesso a agenda, pacientes, procedimentos e atendimento.",
    },
    {
      name: "RECEPCAO",
      description: "Acesso a agenda, pacientes e financeiro.",
    },
  ]

  const roles = {}
  for (const r of rolesData) {
    roles[r.name] = await prisma.role.upsert({
      where: { name: r.name },
      update: {},
      create: { ...r, system: true, active: true },
    })
  }

  // --- Permissões atômicas por módulo ---
  const permissionsData = [
    { code: "agenda:read", name: "Ver agenda", module: "agenda", action: "read" },
    { code: "agenda:write", name: "Agendar consulta", module: "agenda", action: "write" },
    { code: "agenda:delete", name: "Cancelar consulta", module: "agenda", action: "delete" },
    { code: "pacientes:read", name: "Ver pacientes", module: "pacientes", action: "read" },
    { code: "pacientes:write", name: "Cadastrar/editar paciente", module: "pacientes", action: "write" },
    { code: "pacientes:delete", name: "Excluir paciente", module: "pacientes", action: "delete" },
    { code: "procedimentos:read", name: "Ver procedimentos", module: "procedimentos", action: "read" },
    { code: "procedimentos:write", name: "Gerir procedimentos", module: "procedimentos", action: "write" },
    { code: "procedimentos:delete", name: "Excluir procedimento", module: "procedimentos", action: "delete" },
    { code: "atendimento:read", name: "Ver atendimento", module: "atendimento", action: "read" },
    { code: "atendimento:write", name: "Registrar atendimento", module: "atendimento", action: "write" },
    { code: "atendimento:finalizar", name: "Finalizar atendimento", module: "atendimento", action: "write" },
    { code: "atendimento:delete", name: "Excluir atendimento", module: "atendimento", action: "delete" },
    { code: "financeiro:read", name: "Ver financeiro", module: "financeiro", action: "read" },
    { code: "financeiro:write", name: "Lançar financeiro", module: "financeiro", action: "write" },
    { code: "financeiro:delete", name: "Excluir lançamento", module: "financeiro", action: "delete" },
    { code: "configuracoes:read", name: "Ver configurações", module: "configuracoes", action: "read" },
    { code: "configuracoes:write", name: "Editar configurações", module: "configuracoes", action: "write" },
    { code: "configuracoes:admin", name: "Administrar o sistema", module: "configuracoes", action: "admin" },
  ]

  const permissions = {}
  for (const p of permissionsData) {
    permissions[p.code] = await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    })
  }

  // --- Vínculo role x permissão ---
  const rolePermissionsMap = {
    ADMINISTRADOR: Object.keys(permissions),
    DENTISTA: [
      "agenda:read", "agenda:write",
      "pacientes:read", "pacientes:write",
      "procedimentos:read",
      "atendimento:read", "atendimento:write", "atendimento:finalizar",
      "financeiro:read",
    ],
    RECEPCAO: [
      "agenda:read", "agenda:write",
      "pacientes:read", "pacientes:write",
      "financeiro:read", "financeiro:write",
    ],
  }

  for (const [roleName, codes] of Object.entries(rolePermissionsMap)) {
    const role = roles[roleName]
    if (!role) continue
    for (const code of codes) {
      const perm = permissions[code]
      if (!perm) continue
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: perm.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      })
    }
  }

  console.log(
    `✓ Perfis (${rolesData.length}), permissões (${permissionsData.length}) e vínculos aplicados.`
  )
}

async function seedAdmin() {
  // Idempotência: se o usuário já existe, NÃO recriamos nem sobrescrevemos a
  // senha (o administrador pode tê-la alterado — não interferimos).
  const existing = await prisma.user.findUnique({
    where: { username: INITIAL_ADMIN.username },
  })

  if (existing) {
    console.log(
      `✓ Usuário "${INITIAL_ADMIN.username}" já existe — senha preservada.`
    )
    return
  }

  // A senha só existe aqui como hash bcrypt; nunca é gravada em texto puro.
  const passwordHash = await bcrypt.hash(INITIAL_ADMIN.password, BCRYPT_ROUNDS)

  await prisma.user.create({
    data: {
      username: INITIAL_ADMIN.username,
      passwordHash,
      role: INITIAL_ADMIN.role,
      active: true,
    },
  })

  // Log sem a senha.
  console.log(
    `✓ Usuário administrador inicial criado (perfil ${INITIAL_ADMIN.role}).`
  )
  console.log(
    "  IMPORTANTE: altere a senha inicial de demonstração no primeiro acesso."
  )
}

async function seedProcedures() {
  const procedures = [
    { name: "Avaliação odontológica", code: "PROC-001", defaultPrice: 100.0 },
    { name: "Limpeza", code: "PROC-002", defaultPrice: 150.0 },
    { name: "Restauração", code: "PROC-003", defaultPrice: 250.0 },
    { name: "Clareamento", code: "PROC-004", defaultPrice: 500.0 },
    { name: "Extração", code: "PROC-005", defaultPrice: 200.0 },
    { name: "Radiografia", code: "PROC-006", defaultPrice: 80.0 },
    { name: "Canal", code: "PROC-007", defaultPrice: 400.0 },
    { name: "Prótese", code: "PROC-008", defaultPrice: 600.0 },
    { name: "Implante", code: "PROC-009", defaultPrice: 1500.0 },
    { name: "Aparelho ortodôntico", code: "PROC-010", defaultPrice: 0.0 },
  ]

  for (const proc of procedures) {
    await prisma.procedure.upsert({
      where: { name: proc.name },
      update: {},
      create: proc,
    })
  }

  console.log(`✓ Catálogo com ${procedures.length} procedimentos garantido.`)
}

async function main() {
  console.log("Iniciando seed de produção do OdontoCare...")

  // Ordem importa: perfis/permissões antes do usuário (que referencia o role).
  await seedPermissionsAndRoles()
  await seedAdmin()
  await seedProcedures()

  console.log("Seed de produção concluído com sucesso.")
}

main()
  .catch((e) => {
    console.error("Erro durante o seed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

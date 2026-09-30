import { PrismaClient } from "@prisma/client"
import crypto from "crypto"

const prisma = new PrismaClient()

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = crypto
    .pbkdf2Sync(password, salt, 1000, 64, "sha512")
    .toString("hex")
  return `${salt}:${hash}`
}

// Função para verificar se a senha corresponde ao hash (usada pelo login).
// Mantida aqui por referência, a verificação real está em lib/auth-service.ts.
// function verifyPassword(password, stored) {
//   const [salt, key] = stored.split(":")
//   const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex")
//   return key === hash
// }

async function main() {
  console.log("Iniciando seed...")

  // Criar procedimentos padrão
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
  console.log(`✓ ${procedures.length} procedimentos criados`)

  // Criar alguns pacientes de exemplo
  const samplePatients = [
    {
      fullName: "Maria Silva Oliveira",
      cpf: "52998224725",
      birthDate: new Date("1985-06-15"),
    },
    {
      fullName: "João Santos Pereira",
      cpf: "11144477735",
      birthDate: new Date("1990-03-22"),
    },
    {
      fullName: "Ana Costa Rodrigues",
      cpf: "12345678909",
      birthDate: new Date("1978-11-08"),
    },
  ]

  for (const patient of samplePatients) {
    await prisma.patient.upsert({
      where: { cpf: patient.cpf },
      update: {},
      create: patient,
    })
  }
  console.log(`✓ ${samplePatients.length} pacientes de exemplo criados`)

  // -----------------------------------------------------------------------
  // AUTENTICAÇÃO E PERMISSÕES — Seed de perfis, permissões e admin
  // -----------------------------------------------------------------------

  // 1. Roles (perfis de acesso)
  const rolesData = [
    {
      name: "ADMINISTRADOR",
      description: "Acesso total ao sistema, incluindo configurações.",
      system: true,
    },
    {
      name: "DENTISTA",
      description: "Acesso a agenda, pacientes, procedimentos e atendimento.",
      system: true,
    },
    {
      name: "RECEPCAO",
      description: "Acesso a agenda, pacientes e financeiro (leitura/escrita).",
      system: true,
    },
  ]

  const roles = {}
  for (const r of rolesData) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: {},
      create: r,
    })
    roles[r.name] = role
  }
  console.log("✓ Perfis de acesso criados")

  // 2. Permissões atômicas por módulo
  const permissionsData = [
    // Agenda
    { code: "agenda:read", name: "Ver agenda", module: "agenda", action: "read" },
    { code: "agenda:write", name: "Agendar consulta", module: "agenda", action: "write" },
    { code: "agenda:delete", name: "Cancelar consulta", module: "agenda", action: "delete" },
    // Pacientes
    { code: "pacientes:read", name: "Ver pacientes", module: "pacientes", action: "read" },
    { code: "pacientes:write", name: "Cadastrar/editar paciente", module: "pacientes", action: "write" },
    { code: "pacientes:delete", name: "Excluir paciente", module: "pacientes", action: "delete" },
    // Procedimentos
    { code: "procedimentos:read", name: "Ver procedimentos", module: "procedimentos", action: "read" },
    { code: "procedimentos:write", name: "Gerenciar procedimentos", module: "procedimentos", action: "write" },
    // Atendimento
    { code: "atendimento:read", name: "Ver atendimentos", module: "atendimento", action: "read" },
    { code: "atendimento:write", name: "Realizar atendimento", module: "atendimento", action: "write" },
    { code: "atendimento:finalizar", name: "Finalizar atendimento", module: "atendimento", action: "admin" },
    // Financeiro
    { code: "financeiro:read", name: "Ver financeiro", module: "financeiro", action: "read" },
    { code: "financeiro:write", name: "Lançar movimentações", module: "financeiro", action: "write" },
    { code: "financeiro:delete", name: "Excluir movimentações", module: "financeiro", action: "delete" },
    // Configurações
    { code: "config:read", name: "Ver configurações", module: "configuracoes", action: "read" },
    { code: "config:write", name: "Alterar configurações", module: "configuracoes", action: "write" },
    { code: "config:admin", name: "Gerenciar permissões", module: "configuracoes", action: "admin" },
  ]

  const permissions = {}
  for (const p of permissionsData) {
    const perm = await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    })
    permissions[p.code] = perm
  }
  console.log(`✓ ${permissionsData.length} permissões criadas`)

  // 3. Associar permissões aos perfis
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

  for (const [roleName, permCodes] of Object.entries(rolePermissionsMap)) {
    const role = roles[roleName]
    if (!role) continue

    for (const code of permCodes) {
      const perm = permissions[code]
      if (!perm) continue

      await prisma.rolePermission
        .upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: perm.id,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            permissionId: perm.id,
          },
        })
        .catch(() => {
          // Ignora conflitos de unicidade
        })
    }
  }
  console.log("✓ Permissões associadas aos perfis")

  // 4. Usuário administrador padrão
  // Senha: admin123 (em produção, troque imediatamente!)
  const adminPassword = hashPassword("admin123")

  await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash: adminPassword,
      role: "ADMINISTRADOR",
      active: true,
    },
  })
  console.log("✓ Usuário admin criado (senha: admin123)")

  // 5. Usuário demo: dentista
  const dentistaPassword = hashPassword("dentista123")
  await prisma.user.upsert({
    where: { username: "dentista" },
    update: {},
    create: {
      username: "dentista",
      passwordHash: dentistaPassword,
      role: "DENTISTA",
      active: true,
    },
  })
  console.log("✓ Usuário dentista criado (senha: dentista123)")

  // 6. Usuário demo: recepção
  const recepcaoPassword = hashPassword("recepcao123")
  await prisma.user.upsert({
    where: { username: "recepcao" },
    update: {},
    create: {
      username: "recepcao",
      passwordHash: recepcaoPassword,
      role: "RECEPCAO",
      active: true,
    },
  })
  console.log("✓ Usuário recepcao criado (senha: recepcao123)")

  console.log("Seed concluído com sucesso!")
}

main()
  .catch((e) => {
    console.error("Erro durante seed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
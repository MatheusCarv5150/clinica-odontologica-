// scripts/migrate-data.mjs
// Migração de dados SQLite → PostgreSQL via Prisma Client
// Lê do banco SQLite (DATABASE_URL_SQLITE) e escreve no PostgreSQL (DATABASE_URL_PG)

import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const logFile = path.join(root, 'scripts', '_migration', 'migrate-data.txt')
const logStream = fs.createWriteStream(logFile, { flags: 'a' })
const log = (m) => { logStream.write(m + '\n'); console.log(m) }

log(`=== MIGRATE DATA ${new Date().toISOString()} ===`)

// ── 1. Conexões ──────────────────────────────────────────────────────────
const sqliteUrl = `file:${path.join(root, 'prisma', 'dev.db')}`
const pgUrl = fs.readFileSync(
  path.join(root, 'scripts', '_migration', '.test-db-url.txt'), 'utf8'
).trim()

log(`SQLite: ${sqliteUrl}`)
log(`PG    : ${pgUrl}`)

// Cria client temporário para ler do SQLite usando schema original
const prismaSqlite = new PrismaClient({
  datasources: { db: { url: sqliteUrl } },
})

// Cria client para PostgreSQL
const prismaPg = new PrismaClient({
  datasources: { db: { url: pgUrl } },
})

// ── 2. Definição das tabelas na ordem de dependência ────────────────────
const TABLE_ORDER = [
  // Tabelas independentes (sem FK)
  'procedures',            // catálogo de procedimentos
  'insurance_plans',       // planos de saúde
  'expense_categories',    // categorias de despesa
  'professionals',         // profissionais
  'roles',                 // papéis de permissão
  'permissions',           // permissões

  // Tabelas que só dependem das acima
  'patients',              // pacientes
  'role_permissions',      // depende de roles + permissions

  // Tabelas que dependem de pacientes e/ou appointments
  'appointments',          // depende de patients
  'appointment_procedures',// depende de appointments
  'payments',              // depende de appointments
  'anamnesis',             // depende de patients, appointments
  'anamnesis_records',     // depende de patients
  'anamnesis_answers',     // depende de anamnesis_records
  'anamnesis_record_items',// depende de anamnesis_records
  'anamnesis_session_answers',// depende de anamnesis_answers
  'anamnesis_change_logs', // depende de anamnesis
  'odontogram_events',     // depende de patients, appointments
  'tooth_states',          // depende de patients
  'appointment_procedure_executions', // depende de patients, appointments
  'procedure_execution_change_logs',  // depende de executions
  'treatment_plans',       // depende de patients
  'treatment_plan_items',  // depende de treatment_plans
  'treatment_plan_item_change_logs', // depende de treatment_plan_items
  'prescriptions',         // depende de patients, appointments
  'prescription_items',    // depende de prescriptions
  'prescription_logs',     // depende de prescriptions
  'patient_documents',     // depende de patients, appointments
  'appointment_evolutions',// depende de patients, appointments
  'appointment_procedure_records', // depende de appointments
  'appointment_finalization_logs', // depende de patients, appointments
  'expenses',              // depende de expense_categories, patients, appointments
  'financial_transactions',// depende de payments, expenses, patients, appointments
  'financial_closings',    // independente (depois das transações)
  'financial_closing_logs',// depende de financial_closings
  'users',                 // depende de professionals
]

// ── 3. Mapeamento manual de tabela → modelo Prisma (lowercase) ──────────
const MODEL_MAP = {
  procedures: 'procedure',
  insurance_plans: 'insurancePlan',
  expense_categories: 'expenseCategory',
  professionals: 'professional',
  roles: 'role',
  permissions: 'permission',
  patients: 'patient',
  role_permissions: 'rolePermission',
  appointments: 'appointment',
  appointment_procedures: 'appointmentProcedure',
  payments: 'payment',
  anamnesis: 'anamnesis',
  anamnesis_records: 'anamnesisRecord',
  anamnesis_answers: 'anamnesisAnswer',
  anamnesis_record_items: 'anamnesisRecordItem',
  anamnesis_session_answers: 'anamnesisSessionAnswer',
  anamnesis_change_logs: 'anamnesisChangeLog',
  odontogram_events: 'odontogramEvent',
  tooth_states: 'toothState',
  appointment_procedure_executions: 'appointmentProcedureExecution',
  procedure_execution_change_logs: 'procedureExecutionChangeLog',
  treatment_plans: 'treatmentPlan',
  treatment_plan_items: 'treatmentPlanItem',
  treatment_plan_item_change_logs: 'treatmentPlanItemChangeLog',
  prescriptions: 'prescription',
  prescription_items: 'prescriptionItem',
  prescription_logs: 'prescriptionLog',
  patient_documents: 'patientDocument',
  appointment_evolutions: 'appointmentEvolution',
  appointment_procedure_records: 'appointmentProcedureRecord',
  appointment_finalization_logs: 'appointmentFinalizationLog',
  expenses: 'expense',
  financial_transactions: 'financialTransaction',
  financial_closings: 'financialClosing',
  financial_closing_logs: 'financialClosingLog',
  users: 'user',
}

let totalInserted = 0
let totalErrors = 0

// ── 4. Função de migração genérica ──────────────────────────────────────
async function migrateTable(tableName) {
  const modelName = MODEL_MAP[tableName]
  if (!modelName) {
    log(`  AVISO: modelo não mapeado para ${tableName}, pulando`)
    return
  }

  try {
    // Lê do SQLite usando query raw (evita schema mismatch)
    const rows = await prismaSqlite.$queryRawUnsafe(`SELECT * FROM "${tableName}"`)
    
    if (!rows || rows.length === 0) {
      log(`  ${tableName}: 0 registros (vazio)`)
      return
    }

    log(`  ${tableName}: ${rows.length} registros lidos do SQLite`)

    // Verifica se a tabela existe no PG
    const pgCheck = await prismaPg.$queryRawUnsafe(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${tableName}') AS exist`
    )
    if (!pgCheck[0]?.exist) {
      log(`  AVISO: tabela ${tableName} não existe no PG, pulando`)
      return
    }

    // Insere no PG via raw SQL
    const columns = Object.keys(rows[0]).map(c => `"${c}"`).join(', ')
    const placeholders = Object.keys(rows[0]).map((_, i) => `$${i + 1}`).join(', ')
    const insertSQL = `INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`

    let inserted = 0
    for (const row of rows) {
      const values = Object.values(row).map(v => {
        if (v === null || v === undefined) return null
        if (typeof v === 'bigint') return Number(v)
        return v
      })
      try {
        await prismaPg.$executeRawUnsafe(insertSQL, ...values)
        inserted++
      } catch (err) {
        // Tenta sem ON CONFLICT se falhar
        const insertSQLSimple = `INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders})`
        try {
          await prismaPg.$executeRawUnsafe(insertSQLSimple, ...values)
          inserted++
        } catch (err2) {
          log(`    ERRO linha ${inserted + 1}: ${err2.message.slice(0, 120)}`)
          totalErrors++
        }
      }
    }

    log(`  ${tableName}: ${inserted}/${rows.length} inseridos no PG`)
    totalInserted += inserted
  } catch (err) {
    log(`  ERRO em ${tableName}: ${err.message.slice(0, 150)}`)
    totalErrors++
  }
}

// ── 5. Execução em ordem ────────────────────────────────────────────────
async function main() {
  const start = Date.now()

  for (const table of TABLE_ORDER) {
    log(`\n--- ${table} ---`)
    await migrateTable(table)
  }

  log(`\n${'='.repeat(50)}`)
  log('RESUMO')
  log(`${'='.repeat(50)}`)
  log(`Total registros inseridos: ${totalInserted}`)
  log(`Total erros: ${totalErrors}`)

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  log(`Duração: ${elapsed}s`)

  await prismaSqlite.$disconnect()
  await prismaPg.$disconnect()
  logStream.end()
}

main().catch(err => {
  log(`FATAL: ${err.message}`)
  console.error(err)
  process.exit(1)
})

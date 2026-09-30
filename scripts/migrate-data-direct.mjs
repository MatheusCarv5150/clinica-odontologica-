// scripts/migrate-data-direct.mjs
// Abordagem direta: lê do SQLite com better-sqlite3 (ou sql.js) e escreve no PG com @prisma/client PG schema

import { PrismaClient } from '@prisma/client'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const logFile = path.join(root, 'scripts', '_migration', 'migrate-data.txt')
const logStream = fs.createWriteStream(logFile, { flags: 'a' })
const log = (m) => { logStream.write(m + '\n'); console.log(m) }

log(`=== MIGRATE DATA DIRECT ${new Date().toISOString()} ===`)

// ── 1. Conexões ──────────────────────────────────────────────────────────
const sqlitePath = path.join(root, 'prisma', 'dev.db')
const pgUrl = fs.readFileSync(
  path.join(root, 'scripts', '_migration', '.test-db-url.txt'), 'utf8'
).trim()

log(`SQLite: ${sqlitePath}`)
log(`PG    : ${pgUrl}`)

// Conecta SQLite com better-sqlite3
let dbSqlite
try {
  dbSqlite = new Database(sqlitePath)
  log('SQLite: conectado')
} catch (e) {
  log(`SQLite ERRO: ${e.message}`)
  process.exit(1)
}

// Conecta PostgreSQL via PrismaClient com schema PG
const prismaPg = new PrismaClient({
  datasources: { db: { url: pgUrl } },
})
await prismaPg.$connect()
log('PG: conectado')

// ── 2. Tabelas na ordem de dependência ────────────────────────────────────
const TABLE_ORDER = [
  'procedures',
  'insurance_plans',
  'expense_categories',
  'professionals',
  'roles',
  'permissions',
  'patients',
  'role_permissions',
  'appointments',
  'appointment_procedures',
  'payments',
  'anamnesis',
  'anamnesis_records',
  'anamnesis_answers',
  'anamnesis_record_items',
  'anamnesis_session_answers',
  'anamnesis_change_logs',
  'odontogram_events',
  'tooth_states',
  'appointment_procedure_executions',
  'procedure_execution_change_logs',
  'treatment_plans',
  'treatment_plan_items',
  'treatment_plan_item_change_logs',
  'prescriptions',
  'prescription_items',
  'prescription_logs',
  'patient_documents',
  'appointment_evolutions',
  'appointment_procedure_records',
  'appointment_finalization_logs',
  'expenses',
  'financial_transactions',
  'financial_closings',
  'financial_closing_logs',
  'users',
]

// ── 3. Helper: serializa valor para SQL ──────────────────────────────────
function escapeVal(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v instanceof Date) return `'${v.toISOString().replace('T', ' ').replace('Z', '')}'`
  // String: escapa aspas simples
  const s = String(v).replace(/'/g, "''")
  return `'${s}'`
}

let totalInserted = 0
let totalErrors = 0

// ── 4. Migra cada tabela ────────────────────────────────────────────────
for (const table of TABLE_ORDER) {
  try {
    // Lê do SQLite
    const rows = dbSqlite.prepare(`SELECT * FROM "${table}"`).all()
    log(`\n--- ${table} (${rows.length} registros) ---`)

    if (rows.length === 0) continue

    // Verifica se tabela existe no PG
    const tblCheck = await prismaPg.$queryRawUnsafe(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1) AS exist`,
      table
    )
    if (!tblCheck[0]?.exist) {
      log(`  AVISO: tabela ${table} não existe no PG`)
      continue
    }

    // Descobre colunas da primeira linha
    const columns = Object.keys(rows[0])
    const colList = columns.map(c => `"${c}"`).join(', ')

    let inserted = 0
    for (const row of rows) {
      const values = columns.map(c => escapeVal(row[c]))
      const sql = `INSERT INTO "${table}" (${colList}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING`
      try {
        await prismaPg.$executeRawUnsafe(sql)
        inserted++
      } catch (err) {
        log(`    ERRO linha: ${err.message.slice(0, 120)}`)
        totalErrors++
      }
    }

    log(`  PG: ${inserted}/${rows.length}`)
    totalInserted += inserted
  } catch (err) {
    log(`  ERRO em ${table}: ${err.message.slice(0, 150)}`)
    totalErrors++
  }
}

// ── 5. Resumo ────────────────────────────────────────────────────────────
log(`\n${'='.repeat(50)}`)
log('RESUMO')
log(`Total registros inseridos: ${totalInserted}`)
log(`Total erros: ${totalErrors}`)

dbSqlite.close()
await prismaPg.$disconnect()
logStream.end()

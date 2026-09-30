// scripts/migrate-data-intersect.mjs
// Migração SQLite → PostgreSQL usando apenas as colunas que existem em AMBOS os bancos
// Lê do SQLite com better-sqlite3, escreve no PG com @prisma-pg/client

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

log(`\n=== MIGRATE DATA INTERSECT ${new Date().toISOString()} ===`)

// ── 1. Conexões ──────────────────────────────────────────────────────────
const sqlitePath = path.join(root, 'prisma', 'dev.db')
const pgUrl = fs.readFileSync(
  path.join(root, 'scripts', '_migration', '.test-db-url.txt'), 'utf8'
).trim()

log(`SQLite: ${sqlitePath}`)
log(`PG    : ${pgUrl}`)

const dbSqlite = new Database(sqlitePath)
const prismaPg = new PrismaClient({ datasources: { db: { url: pgUrl } } })
await prismaPg.$connect()
log('Conectado OK')

// ── 2. Tabelas na ordem de dependência ────────────────────────────────────
const TABLE_ORDER = [
  'procedures', 'insurance_plans', 'expense_categories', 'professionals',
  'roles', 'permissions', 'patients', 'role_permissions', 'appointments',
  'appointment_procedures', 'payments', 'anamnesis', 'anamnesis_records',
  'anamnesis_answers', 'anamnesis_record_items', 'anamnesis_session_answers',
  'anamnesis_change_logs', 'odontogram_events', 'tooth_states',
  'appointment_procedure_executions', 'procedure_execution_change_logs',
  'treatment_plans', 'treatment_plan_items', 'treatment_plan_item_change_logs',
  'prescriptions', 'prescription_items', 'prescription_logs',
  'patient_documents', 'appointment_evolutions', 'appointment_procedure_records',
  'appointment_finalization_logs', 'expenses', 'financial_transactions',
  'financial_closings', 'financial_closing_logs', 'users',
]

function formatValue(v, colName, pgColMeta) {
  // Formata valor SQLite para string SQL literal com casting conforme tipo PG
  if (v === null || v === undefined) return 'NULL'

  const meta = pgColMeta[colName]
  const pgType = meta ? meta.data_type.toLowerCase() : 'text'

  if (typeof v === 'bigint') v = Number(v)

  // ── Boolean ──
  if (pgType === 'boolean') {
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') return v !== 0 ? 'true' : 'false'
    const s = String(v).toLowerCase()
    if (s === '1' || s === 't' || s === 'true') return 'true'
    if (s === '0' || s === 'f' || s === 'false') return 'false'
    return 'false'
  }

  // ── Integer / SmallInt / BigInt ──
  if (pgType === 'integer' || pgType === 'int' || pgType === 'int4' ||
      pgType === 'smallint' || pgType === 'int2' ||
      pgType === 'bigint' || pgType === 'int8') {
    if (typeof v === 'number') return String(Math.floor(v))
    return String(Math.floor(Number(v) || 0))
  }

  // ── Decimal / Float / Real ──
  if (pgType === 'decimal' || pgType === 'numeric' || pgType === 'real' ||
      pgType === 'float' || pgType === 'float4' || pgType === 'float8' ||
      pgType === 'double precision') {
    if (typeof v === 'number') return String(v)
    return String(Number(v) || 0)
  }

  // ── Timestamp / Date ──
  if (pgType === 'timestamp without time zone' || pgType === 'timestamp' ||
      pgType === 'timestamp(3) without time zone' ||
      pgType === 'date' || pgType === 'datetime') {
    if (v instanceof Date) return `'${v.toISOString().replace('T', ' ').replace('Z', '')}'`
    if (typeof v === 'number') {
      // Assume milliseconds Unix timestamp
      const d = new Date(v)
      return `'${d.toISOString().replace('T', ' ').replace('Z', '')}'`
    }
    // String: tenta parsear
    const s = String(v)
    if (s && !isNaN(Number(s))) {
      const d2 = new Date(Number(s))
      return `'${d2.toISOString().replace('T', ' ').replace('Z', '')}'`
    }
    return `'${s}'`
  }

  // ── JSON / JSONB ──
  if (pgType === 'json' || pgType === 'jsonb') {
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return `'${s.replace(/'/g, "''")}'::jsonb`
  }

  // ── UUID (id textual) ──
  // Strings em geral
  const sv = String(v)
  if (sv === '') return "''"
  return `'${sv.replace(/'/g, "''")}'`
}

let totalInserted = 0
let totalErrors = 0

for (const table of TABLE_ORDER) {
  try {
    const rows = dbSqlite.prepare(`SELECT * FROM "${table}"`).all()
    log(`\n--- ${table} (${rows.length} registros) ---`)
    if (rows.length === 0) continue

    // Verifica se tabela existe no PG
    const tblCheck = await prismaPg.$queryRawUnsafe(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1) AS exist`, table
    )
    if (!tblCheck[0]?.exist) {
      log(`  AVISO: tabela ${table} não existe no PG`)
      continue
    }

    // Colunas e seus tipos no PG
    const pgCols = await prismaPg.$queryRawUnsafe(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`, table
    )
    const pgColSet = new Set(pgCols.map(c => c.column_name))
    const pgColMeta = {}
    for (const c of pgCols) {
      pgColMeta[c.column_name] = c
    }

    // Intersect: colunas que existem em ambos
    const sqliteCols = Object.keys(rows[0])
    const commonCols = sqliteCols.filter(c => pgColSet.has(c))
    if (commonCols.length === 0) {
      log(`  AVISO: nenhuma coluna em comum`)
      continue
    }

    // Log das colunas comuns
    const colInfo = commonCols.map(c => `${c}(${pgColMeta[c]?.data_type || '?'})`).join(', ')
    log(`  Colunas: ${colInfo}`)

    const colList = commonCols.map(c => `"${c}"`).join(', ')
    let inserted = 0

    for (const row of rows) {
      const values = commonCols.map(c => formatValue(row[c], c, pgColMeta)).join(', ')
      const sql = `INSERT INTO "${table}" (${colList}) VALUES (${values}) ON CONFLICT DO NOTHING`
      try {
        await prismaPg.$executeRawUnsafe(sql)
        inserted++
      } catch (err) {
        log(`    ERRO linha: ${err.message.slice(0, 200)}`)
        // Re-tenta sem ON CONFLICT
        try {
          const sql2 = `INSERT INTO "${table}" (${colList}) VALUES (${values})`
          await prismaPg.$executeRawUnsafe(sql2)
          inserted++
        } catch (err2) {
          log(`    ERRO2 linha: ${err2.message.slice(0, 200)}`)
          totalErrors++
        }
      }
    }

    log(`  PG: ${inserted}/${rows.length}`)
    totalInserted += inserted
  } catch (err) {
    log(`  ERRO em ${table}: ${err.message.slice(0, 150)}`)
    totalErrors++
  }
}

log(`\n${'='.repeat(50)}`)
log(`RESUMO`)
log(`Total registros inseridos: ${totalInserted}`)
log(`Total erros: ${totalErrors}`)

dbSqlite.close()
await prismaPg.$disconnect()
logStream.end()
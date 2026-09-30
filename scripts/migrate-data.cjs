const { PrismaClient: PrismaClientSQLite } = require('@prisma/client');
const { PrismaClient: PrismaClientPG } = require('@prisma-pg/client');
const path = require('path');
const fs = require('fs');

// ── Paths ───────────────────────────────────────────────────────────────
const SCRIPT_DIR  = __dirname;
const ROOT        = path.resolve(SCRIPT_DIR, '..');
const SQLITE_DB   = path.join(ROOT, 'prisma', 'dev.db');
const PG_URL_FILE = path.join(ROOT, 'scripts', '_migration', '.test-db-url.txt');
const LOG_FILE    = path.join(ROOT, 'scripts', '_migration', 'migrate-data.txt');
const PRISMA_DIR  = path.join(ROOT, 'prisma');

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
function log(m) { logStream.write(m + '\n'); console.log(m); }

log(`=== MIGRATE DATA ${new Date().toISOString()} ===`);

const pgUrl = fs.readFileSync(PG_URL_FILE, 'utf8').trim();
log(`SQLite: ${SQLITE_DB}`);
log(`PG    : ${pgUrl}`);

// ── Helper ──────────────────────────────────────────────────────────────
function escapeVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString().replace('T', ' ').replace('Z', '')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ── Table order (FK-safe) ───────────────────────────────────────────────
const TABLE_ORDER = [
  'procedures', 'insurance_plans', 'expense_categories', 'professionals',
  'roles', 'permissions', 'patients', 'role_permissions', 'appointments',
  'appointment_procedures', 'payments', 'anamnesis', 'anamnesis_records',
  'anamnesis_answers', 'anamnesis_record_items', 'anamnesis_session_answers',
  'anamnesis_change_logs', 'odontogram_events', 'tooth_states',
  'appointment_procedure_executions', 'procedure_execution_change_logs',
  'treatment_plans', 'treatment_plan_items', 'treatment_plan_item_change_logs',
  'prescriptions', 'prescription_items', 'prescription_logs', 'patient_documents',
  'appointment_evolutions', 'appointment_procedure_records',
  'appointment_finalization_logs', 'expenses', 'financial_transactions',
  'financial_closings', 'financial_closing_logs', 'users',
];

async function main() {
  const start = Date.now();
  let totalInserted = 0;
  let totalErrors = 0;

  // ── Connect SQLite ──────────────────────────────────────────────────
  const origCwd = process.cwd();
  process.chdir(PRISMA_DIR);
  const sqlite = new PrismaClientSQLite({ datasources: { db: { url: 'file:./dev.db' } } });
  await sqlite.$connect();
  process.chdir(origCwd);
  log('SQLite: OK');

  // ── Connect PG ──────────────────────────────────────────────────────
  const pg = new PrismaClientPG({ datasources: { db: { url: pgUrl } } });
  await pg.$connect();
  log('PG: OK');

  // ── Truncate PG tables before insert (fresh start) ───────────────────
  log('\nLimpando tabelas no PG antes de inserir...');
  for (const table of [...TABLE_ORDER].reverse()) {
    try { await pg.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`); }
    catch { /* skip if table doesnt exist */ }
  }
  log('PG: truncate concluído');

  // ── Migrate ─────────────────────────────────────────────────────────
  for (const table of TABLE_ORDER) {
    try {
      const rows = await sqlite.$queryRawUnsafe(`SELECT * FROM "${table}"`);
      log(`\n--- ${table} (${rows.length} registros) ---`);
      if (!rows || rows.length === 0) continue;

      const [tblCheck] = await pg.$queryRawUnsafe(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1) AS exist`, table
      );
      if (!tblCheck.exist) { log(`  AVISO: tabela "${table}" não existe no PG`); continue; }

      const columns = Object.keys(rows[0]);
      const colList = columns.map(c => `"${c}"`).join(', ');
      let inserted = 0;

      for (const row of rows) {
        const values = columns.map(c => escapeVal(row[c]));
        try {
          await pg.$executeRawUnsafe(
            `INSERT INTO "${table}" (${colList}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING`
          );
          inserted++;
        } catch (err) {
          log(`  ERRO #${inserted + 1}: ${err.message.slice(0, 120)}`);
          totalErrors++;
        }
      }
      log(`  → inseridos ${inserted}/${rows.length}`);
      totalInserted += inserted;
    } catch (err) {
      log(`  ERRO em ${table}: ${err.message.slice(0, 150)}`);
      totalErrors++;
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`\n${'='.repeat(50)}`);
  log('RESUMO');
  log(`  Registros inseridos no PG: ${totalInserted}`);
  log(`  Erros: ${totalErrors}`);
  log(`  Duração: ${elapsed}s`);

  await sqlite.$disconnect();
  await pg.$disconnect();
  logStream.end();
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  console.error(err);
  process.exit(1);
});

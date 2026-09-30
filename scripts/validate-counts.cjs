// scripts/validate-counts.cjs
// Valida contagens SQLite vs PostgreSQL por tabela
const { PrismaClient: PrismaClientSQLite } = require('@prisma/client');
const { PrismaClient: PrismaClientPG } = require('@prisma-pg/client');
const path = require('path');
const fs = require('fs');

const ROOT        = path.resolve(__dirname, '..');
const PG_URL_FILE = path.join(ROOT, 'scripts', '_migration', '.test-db-url.txt');
const PRISMA_DIR  = path.join(ROOT, 'prisma');

const pgUrl = fs.readFileSync(PG_URL_FILE, 'utf8').trim();

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

async function countTable(prisma, table) {
  try {
    const [r] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM "${table}"`);
    return Number(r.c);
  } catch {
    return -1; // tabela não existe
  }
}

async function main() {
  const origCwd = process.cwd();
  process.chdir(PRISMA_DIR);
  const sqlite = new PrismaClientSQLite({ datasources: { db: { url: 'file:./dev.db' } } });
  await sqlite.$connect();
  process.chdir(origCwd);
  const pg = new PrismaClientPG({ datasources: { db: { url: pgUrl } } });
  await pg.$connect();

  console.log('TABLE'.padEnd(38) + 'SQLITE'.padStart(8) + 'PG'.padStart(8) + 'STATUS');
  console.log('-'.repeat(66));
  let mismatches = 0;
  for (const t of TABLE_ORDER) {
    const s = await countTable(sqlite, t);
    const p = await countTable(pg, t);
    const status = s === p ? 'OK' : (s === -1 && p === -1) ? 'OK(-)' : '*** MISMATH';
    if (status.includes('MISM')) mismatches++;
    console.log(t.padEnd(38) + String(s).padStart(8) + String(p).padStart(8) + '  ' + status);
  }
  console.log('-'.repeat(66));
  console.log(`Divergências: ${mismatches}`);

  await sqlite.$disconnect();
  await pg.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
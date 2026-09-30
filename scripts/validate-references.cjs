// scripts/validate-references.cjs
// Valida integridade referencial no PG: todas as FKs devem apontar para registros existentes
const { PrismaClient } = require('@prisma-pg/client');
const path = require('path');
const fs = require('fs');

const ROOT        = path.resolve(__dirname, '..');
const PG_URL_FILE = path.join(ROOT, 'scripts', '_migration', '.test-db-url.txt');
const pgUrl = fs.readFileSync(PG_URL_FILE, 'utf8').trim();

const pg = new PrismaClient({ datasources: { db: { url: pgUrl } } });

async function main() {
  await pg.$connect();
  console.log('=== VALIDAÇÃO DE INTEGRIDADE REFERENCIAL ===\n');

  // Busca todas as FKs do schema
  const fks = await pg.$queryRawUnsafe(`
    SELECT
      con.conname AS fk_name,
      cl.relname AS source_table,
      a.attname AS source_column,
      cl2.relname AS target_table,
      a2.attname AS target_column
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
    JOIN pg_class cl2 ON cl2.oid = con.confrelid
    JOIN pg_attribute a2 ON a2.attrelid = con.confrelid AND a2.attnum = ANY(con.confkey)
    WHERE con.contype = 'f'
      AND cl.relname NOT LIKE 'pg_%'
      AND cl.relname NOT LIKE '_prisma_%'
    ORDER BY cl.relname, con.conname
  `);

  console.log(`Total de FKs encontradas: ${fks.length}\n`);

  let totalOrphans = 0;
  let totalChecked = 0;

  // Agrupa FKs por tabela origem
  const grouped = {};
  for (const fk of fks) {
    const key = `${fk.source_table}.${fk.source_column} -> ${fk.target_table}.${fk.target_column}`;
    if (!grouped[key]) {
      grouped[key] = { source_table: fk.source_table, source_column: fk.source_column, target_table: fk.target_table, target_column: fk.target_column };
    }
  }

  for (const [key, ref] of Object.entries(grouped)) {
    const sql = `
      SELECT COUNT(*) AS orphans FROM "${ref.source_table}" s
      LEFT JOIN "${ref.target_table}" t ON s."${ref.source_column}" = t."${ref.target_column}"
      WHERE s."${ref.source_column}" IS NOT NULL AND t."${ref.target_column}" IS NULL
    `;
    try {
      const [r] = await pg.$queryRawUnsafe(sql);
      const orphans = Number(r.orphans);
      totalChecked++;
      const status = orphans === 0 ? '✅' : '❌';
      console.log(`${status} ${key.padEnd(60)} orphans=${orphans}`);
      totalOrphans += orphans;
    } catch (err) {
      console.log(`⚠️  ${key.padEnd(60)} ERRO: ${err.message.slice(0, 80)}`);
    }
  }

  console.log(`\n${'='.repeat(66)}`);
  console.log(`FKs verificadas: ${totalChecked}`);
  console.log(`Total de órfãos: ${totalOrphans}`);

  if (totalOrphans === 0) {
    console.log('\n✅ INTEGRIDADE REFERENCIAL PERFEITA!');
  } else {
    console.log(`\n❌ ${totalOrphans} registros órfãos encontrados!`);
  }

  await pg.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
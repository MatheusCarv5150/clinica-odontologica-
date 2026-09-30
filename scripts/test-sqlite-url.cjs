// scripts/test-sqlite-url.cjs
const { PrismaClient } = require('@prisma/client');

const url = process.env.DATABASE_URL;
console.log('URL:', url);

const p = new PrismaClient({
  datasources: { db: { url } },
});

p.$queryRawUnsafe('SELECT COUNT(*) as cnt FROM procedures')
  .then(r => console.log('OK:', JSON.stringify(r)))
  .catch(e => console.log('ERRO:', e.message))
  .finally(() => p.$disconnect());

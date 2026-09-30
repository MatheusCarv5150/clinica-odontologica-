// scripts/run-tscheck.cjs
const { execSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

try {
  execSync(`node "${tsc}" --noEmit`, {
    cwd: root,
    stdio: 'inherit'
  });
  console.log('\n✅ TypeScript: sem erros');
} catch (e) {
  console.error('\n❌ TypeScript: ERROS encontrados (acima)');
  process.exit(1);
}

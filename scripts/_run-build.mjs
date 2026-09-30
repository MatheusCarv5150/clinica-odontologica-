// Wrapper temporário: roda `next build` capturando stdout+stderr em arquivo.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, '.tmp', 'build-final.txt');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

let buffer = '';
const child = spawn(process.execPath, [nextBin, 'build'], {
  cwd: root,
  env: { ...process.env, CI: '1' },
});
child.stdout.on('data', (d) => {
  buffer += d.toString();
  writeFileSync(outFile, buffer);
});
child.stderr.on('data', (d) => {
  buffer += d.toString();
  writeFileSync(outFile, buffer);
});
child.on('close', (code) => {
  buffer += `\n=== BUILD_EXIT=${code} ===\n`;
  writeFileSync(outFile, buffer);
  process.exit(code ?? 1);
});

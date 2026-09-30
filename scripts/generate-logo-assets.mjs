/**
 * Gera o favicon oficial do OdontoCare a partir do MESMO símbolo usado em
 * LogoIcon (src/components/common/logo.tsx), garantindo identidade visual única.
 *
 * Uso: node scripts/generate-logo-assets.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const SYMBOL_PATH =
  "M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#2563eb"/>
  <g transform="translate(8 8) scale(2)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="${SYMBOL_PATH}"/>
  </g>
</svg>
`;

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="${SYMBOL_PATH}"/>
  </g>
</svg>
`;

mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, "favicon.svg"), svg, "utf8");
writeFileSync(join(publicDir, "logo-icon.svg"), markSvg, "utf8");

console.log("Assets de logo gerados: public/favicon.svg, public/logo-icon.svg");

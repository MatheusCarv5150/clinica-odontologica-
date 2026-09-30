// ===========================================================================
// HARNESS DOS TESTES DE USUÁRIOS/PROFISSIONAIS — módulo Configurações.
//
// Mesma estratégia dos demais harnesses do projeto: roda FORA do Next,
// compila o serviço sob demanda com o tsc do projeto e instancia o Prisma
// Client contra um SQLite DESCARTAVEL criado a partir do schema real.
//
// Nunca toca no banco de desenvolvimento.
//
// Não executa testes sozinho — quem orquestra é
// scripts/test-professionals.mjs.
// ===========================================================================

import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")

function loadEnv() {
  let raw
  try {
    raw = readFileSync(path.join(root, ".env"), "utf8")
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed)
    if (!match) continue
    const key = match[1]
    if (process.env[key] !== undefined) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadEnv()

// ---------------------------------------------------------------------------
// Banco de teste isolado (SQLite descartável)
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(path.join(root, ".professionals-test-"))
const dbPath = path.join(outDir, "test.db")

function prepareDatabase() {
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "prisma", "build", "index.js"),
      "db",
      "push",
      "--skip-generate",
      "--accept-data-loss",
      "--schema",
      path.join(root, "prisma", "schema.prisma"),
    ],
    {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: "file:" + dbPath },
    },
  )
}

// ---------------------------------------------------------------------------
// Compilação sob demanda do serviço
// ---------------------------------------------------------------------------

const SERVICE_SOURCES = [
  "lib/professionals-domain.ts",
  "lib/schemas-professionals.ts",
  "lib/professionals-service.ts",
  "lib/attendance-finalization-domain.ts",
  "lib/schemas-finalization.ts",
  "lib/attendance-finalization-service.ts",
  "lib/attendance-professional-resolver.ts",
  "lib/prisma.ts",
]

// Dependências transitivas: o serviço importa outros módulos de `src/lib`
// (ex.: `@/lib/schemas`). Como o harness compila um subconjunto isolado,
// varremos os imports a partir das raízes e copiamos o fecho completo.
function collectSources(entries) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    seen.add(rel)
    let source
    try {
      source = readFileSync(path.join(root, "src", rel), "utf8")
    } catch {
      continue
    }
    const importRe = /from\s+["'](@\/[^"']+)["']/g
    let match
    while ((match = importRe.exec(source)) !== null) {
      const spec = match[1].slice(2)
      const candidates = [
        spec + ".ts",
        spec + ".tsx",
        path.join(spec, "index.ts"),
      ]
      for (const candidate of candidates) {
        if (existsSync(path.join(root, "src", candidate))) {
          queue.push(candidate.replace(/\\/g, "/"))
          break
        }
      }
    }
  }
  return [...seen]
}

function walk(dir) {
  const entries = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) entries.push(...walk(full))
    else entries.push(full)
  }
  return entries
}

function compileService() {
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ES2022",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      outDir: "./out",
      rootDir: "./src",
      baseUrl: "./src",
      paths: { "@/*": ["./*"] },
      verbatimModuleSyntax: false,
    },
    include: ["src/**/*.ts"],
  }

  writeFileSync(path.join(outDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2))
  mkdirSync(path.join(outDir, "src", "lib"), { recursive: true })

  for (const rel of collectSources(SERVICE_SOURCES)) {
    const source = readFileSync(path.join(root, "src", rel), "utf8")
    const target = path.join(outDir, "src", rel)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, source)
  }

  try {
    execFileSync(
      process.execPath,
      [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", outDir],
      { stdio: "pipe" },
    )
  } catch (error) {
    const stdout = error.stdout ? error.stdout.toString() : ""
    const stderr = error.stderr ? error.stderr.toString() : ""
    throw new Error("Falha ao compilar o serviço:\n" + stdout + "\n" + stderr)
  }

  const outRoot = path.join(outDir, "out")
  for (const file of walk(outRoot)) {
    if (!file.endsWith(".js")) continue
    const original = readFileSync(file, "utf8")
    const rewritten = original.replace(
      /(from\s+|import\s*\(\s*)(["'])(@\/[^"']+|\.[^"']*)\2/g,
      (_match, prefix, quote, spec) => {
        const resolved = spec.startsWith("@/") ? spec.slice(2) : spec
        const target = spec.startsWith("@/")
          ? path.join(outRoot, resolved)
          : path.resolve(path.dirname(file), spec)
        let withExt = target.endsWith(".js") ? target : target + ".js"
        let relative = path.relative(path.dirname(file), withExt).replace(/\\/g, "/")
        if (!relative.startsWith(".")) relative = "./" + relative
        return `${prefix}${quote}${relative}${quote}`
      },
    )
    if (rewritten !== original) writeFileSync(file, rewritten)
  }
}

// ---------------------------------------------------------------------------
// Infra mínima de testes
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failed++
    failures.push({ name, error })
    console.log(`  ✗ ${name}`)
    console.log(`      ${error.message.split("\n").slice(0, 4).join("\n      ")}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let service
let domain
let schemas
let prisma
let finalization
let resolver

try {
  prepareDatabase()
  process.env.DATABASE_URL = "file:" + dbPath

  compileService()
  const out = path.join(outDir, "out")
  service = await import(
    pathToFileURL(path.join(out, "lib", "professionals-service.js")).href
  )
  domain = await import(
    pathToFileURL(path.join(out, "lib", "professionals-domain.js")).href
  )
  schemas = await import(
    pathToFileURL(path.join(out, "lib", "schemas-professionals.js")).href
  )
  finalization = await import(
    pathToFileURL(path.join(out, "lib", "attendance-finalization-service.js")).href
  )
  resolver = await import(
    pathToFileURL(path.join(out, "lib", "attendance-professional-resolver.js")).href
  )
  const prismaModule = await import(
    pathToFileURL(path.join(out, "lib", "prisma.js")).href
  )
  prisma = prismaModule.prisma
} catch (error) {
  const detail = error && error.stack ? error.stack : String(error)
  process.stderr.write("Não foi possível preparar o serviço para os testes:\n" + detail + "\n")
  rmSync(outDir, { recursive: true, force: true })
  process.exit(1)
}

export { service, domain, schemas, finalization, resolver, prisma, test, section, assert, outDir }

// Encerra o Prisma e remove o diretório temporário. No Windows o arquivo do
// SQLite fica travado enquanto a conexão estiver aberta — por isso o
// disconnect precisa vir ANTES do rmSync.
export async function cleanup() {
  try {
    await prisma.$disconnect()
  } catch {
    // ignore
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(outDir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

export const summary = {
  get passed() {
    return passed
  },
  get failed() {
    return failed
  },
  recordFatal(error) {
    failed++
    failures.push({ name: "(erro fatal)", error })
  },
  report() {
    console.log(`\n${"─".repeat(50)}`)
    console.log(`Resultado: ${passed} passaram, ${failed} falharam`)

    if (failures.length > 0) {
      console.log("\nFalhas:")
      for (const f of failures) {
        console.log(`  • ${f.name}: ${f.error.message.split("\n")[0]}`)
      }
    }

    return failed > 0 ? 1 : 0
  },
}

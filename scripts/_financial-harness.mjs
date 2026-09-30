// ===========================================================================
// HARNESS DOS TESTES FINANCEIROS (Financeiro 1 e 2).
//
// Mesma estratégia dos harnesses anteriores: roda FORA do Next, compila os
// serviços sob demanda com o tsc do projeto e instancia o Prisma Client contra
// um SQLite descartável criado a partir do schema real.
//
// Exercita o SERVIÇO REAL (consolidação, isolamento, integridade), não uma
// reimplementação das regras.
//
// IMPORTANTE (Financeiro 2): o serviço de receitas depende da cadeia
// `financial-payments-service` -> `financial-service` -> `financial-domain`.
// Todos entram em SERVICE_SOURCES para que a compilação sob demanda feche.
// ===========================================================================

import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  appendFileSync,
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

const outDir = mkdtempSync(path.join(root, ".financial-test-"))
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
    }
  )
}

// ---------------------------------------------------------------------------
// Compilação sob demanda
// ---------------------------------------------------------------------------

const SERVICE_SOURCES = [
  "lib/schemas.ts",
  "lib/date-utils.ts",
  "lib/prisma.ts",
  "lib/financial-domain.ts",
  "lib/financial-service.ts",
  "lib/financial-expense-service.ts",
  "lib/financial-dashboard-service.ts",
  "lib/financial-payments-service.ts",
  "lib/financial-receitas-service.ts",
  "lib/financial-contas-receber-service.ts",
  "lib/financial-cash-flow-service.ts",
  "lib/financial-reports-service.ts",
  "lib/financial-closing-domain.ts",
  "lib/financial-closing-service.ts",
  "lib/csv-export.ts",
  "lib/schemas-financial.ts",
]

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

  for (const rel of SERVICE_SOURCES) {
    writeFileSync(
      path.join(outDir, "src", rel),
      readFileSync(path.join(root, "src", rel), "utf8")
    )
  }

  try {
    execFileSync(
      process.execPath,
      [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", outDir],
      { stdio: "pipe" }
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
        const withExt = target.endsWith(".js") ? target : target + ".js"
        let relative = path.relative(path.dirname(file), withExt).replace(/\\/g, "/")
        if (!relative.startsWith(".")) relative = "./" + relative
        return `${prefix}${quote}${relative}${quote}`
      }
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

// Alguns shells do Windows (PowerShell 5.1 com redirecionamento) perdem a saída
// de stdout do processo Node. Para garantir que o resultado seja sempre
// auditável, espelhamos o log em um arquivo UTF-8 ao lado do projeto.
const reportPath = path.join(root, "financial-report.txt")
try {
  writeFileSync(reportPath, "", "utf8")
} catch {
  // ignore
}
function mirror(line) {
  try {
    appendFileSync(reportPath, line + "\n", "utf8")
  } catch {
    // ignore
  }
}
function log(line) {
  console.log(line)
  mirror(line)
}

async function test(name, fn) {
  try {
    await fn()
    passed++
    log(`  ✓ ${name}`)
  } catch (error) {
    failed++
    failures.push({ name, error })
    log(`  ✗ ${name}`)
    log(`      ${error.message.split("\n").slice(0, 4).join("\n      ")}`)
  }
}

function section(title) {
  log(`\n${title}`)
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let domain
let service
let expenseService
let dashboardService
let paymentsService
let receitasService
let contasReceberService
let cashFlowService
let reportsService
let closingDomain
let closingService
let csvExport
let schemas
let prisma

try {
  prepareDatabase()
  process.env.DATABASE_URL = "file:" + dbPath

  compileService()
  const out = path.join(outDir, "out")
  domain = await import(pathToFileURL(path.join(out, "lib", "financial-domain.js")).href)
  service = await import(pathToFileURL(path.join(out, "lib", "financial-service.js")).href)
  expenseService = await import(
    pathToFileURL(path.join(out, "lib", "financial-expense-service.js")).href
  )
  dashboardService = await import(
    pathToFileURL(path.join(out, "lib", "financial-dashboard-service.js")).href
  )
  paymentsService = await import(
    pathToFileURL(path.join(out, "lib", "financial-payments-service.js")).href
  )
  receitasService = await import(
    pathToFileURL(path.join(out, "lib", "financial-receitas-service.js")).href
  )
  contasReceberService = await import(
    pathToFileURL(path.join(out, "lib", "financial-contas-receber-service.js")).href
  )
  cashFlowService = await import(
    pathToFileURL(path.join(out, "lib", "financial-cash-flow-service.js")).href
  )
  reportsService = await import(
    pathToFileURL(path.join(out, "lib", "financial-reports-service.js")).href
  )
  closingDomain = await import(
    pathToFileURL(path.join(out, "lib", "financial-closing-domain.js")).href
  )
  closingService = await import(
    pathToFileURL(path.join(out, "lib", "financial-closing-service.js")).href
  )
  csvExport = await import(pathToFileURL(path.join(out, "lib", "csv-export.js")).href)
  schemas = await import(pathToFileURL(path.join(out, "lib", "schemas-financial.js")).href)
  const prismaModule = await import(pathToFileURL(path.join(out, "lib", "prisma.js")).href)
  prisma = prismaModule.prisma
} catch (error) {
  mirror("FALHA AO PREPARAR O AMBIENTE DE TESTES:")
  mirror(String(error && error.stack ? error.stack : error))
  console.error("Não foi possível preparar o serviço para os testes:", error.message)
  rmSync(outDir, { recursive: true, force: true })
  process.exit(1)
}

export {
  domain,
  service,
  expenseService,
  dashboardService,
  paymentsService,
  receitasService,
  contasReceberService,
  cashFlowService,
  reportsService,
  closingDomain,
  closingService,
  csvExport,
  schemas,
  prisma,
  test,
  section,
  assert,
  outDir,
}

// ---------------------------------------------------------------------------
// Resumo final
// ---------------------------------------------------------------------------

export const summary = {
  get passed() {
    return passed
  },
  get failed() {
    return failed
  },
  get failures() {
    return failures
  },
  /** Registra uma falha fatal (erro fora de um `test`). */
  recordFatal(error) {
    failed++
    failures.push({ name: "FALHA FATAL", error })
  },
  /** Imprime o resumo e devolve o código de saída. */
  report() {
    log(`\n${"-".repeat(60)}`)
    log(`Total: ${passed + failed} · Passou: ${passed} · Falhou: ${failed}`)

    if (failed > 0) {
      log("\nFalhas:")
      for (const f of failures) {
        log(`\n  ✗ ${f.name}`)
        log(`    ${f.error.message.split("\n").slice(0, 6).join("\n    ")}`)
      }
      return 1
    }

    log("Todos os cenários financeiros passaram.")
    return 0
  },
}

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

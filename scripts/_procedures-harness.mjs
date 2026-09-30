// ===========================================================================
// HARNESS DOS TESTES DE PROCEDIMENTOS (Parte 7).
//
// Mesma estratégia do harness do odontograma: roda FORA do Next, compila o
// serviço sob demanda com o tsc do projeto e instancia o Prisma Client contra
// o banco apontado por .env.
//
// DB de teste: SQLITE isolado (arquivo descartável), criado a partir do
// schema Prisma real. Nunca toca no banco de desenvolvimento.
//
// Não executa nenhum teste sozinho — quem orquestra é
// scripts/test-procedures.mjs.
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

const outDir = mkdtempSync(path.join(root, ".procedures-test-"))
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
  "lib/tooth-catalog.ts",
  "lib/odontogram-domain.ts",
  "lib/schemas-odontogram.ts",
  "lib/odontogram-service.ts",
  "lib/procedure-execution-domain.ts",
  "lib/schemas-procedures.ts",
  "lib/procedures-service.ts",
  "lib/prisma.ts",
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
      readFileSync(path.join(root, "src", rel), "utf8"),
    )
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
let catalog
let schemas
let prisma

try {
  prepareDatabase()
  process.env.DATABASE_URL = "file:" + dbPath

  compileService()
  const out = path.join(outDir, "out")
  service = await import(
    pathToFileURL(path.join(out, "lib", "procedures-service.js")).href
  )
  domain = await import(
    pathToFileURL(path.join(out, "lib", "procedure-execution-domain.js")).href
  )
  catalog = await import(
    pathToFileURL(path.join(out, "lib", "tooth-catalog.js")).href
  )
  schemas = await import(
    pathToFileURL(path.join(out, "lib", "schemas-procedures.js")).href
  )
  const prismaModule = await import(
    pathToFileURL(path.join(out, "lib", "prisma.js")).href
  )
  prisma = prismaModule.prisma
} catch (error) {
  console.error("Não foi possível preparar o serviço para os testes:", error.message)
  rmSync(outDir, { recursive: true, force: true })
  process.exit(1)
}

export { service, domain, catalog, schemas, prisma, test, section, assert, outDir }

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
      // pequena espera para o SO liberar o handle do arquivo
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let cpfCounter = 0
function nextCpf() {
  cpfCounter++
  return String(90700000000 + cpfCounter)
}

export async function createPatient(name = "Paciente Procedimentos") {
  return prisma.patient.create({
    data: {
      fullName: name,
      cpf: nextCpf(),
      birthDate: new Date("1980-03-20"),
      phone: "11988887777",
    },
    select: { id: true, fullName: true },
  })
}

export async function createAppointment(patientId, status = "in_progress") {
  return prisma.appointment.create({
    data: {
      patientId,
      appointmentDate: new Date("2026-09-15"),
      appointmentTime: "10:00",
      status,
    },
    select: { id: true, status: true },
  })
}

// Garante um procedimento no catálogo REAL (sem duplicar por código).
//
// ATENÇÃO: no schema, Procedure.name E Procedure.code são únicos. Por isso o
// helper SEMPRE gera nome e código distintos por chamada — reutilizar o nome
// padrão quebraria no segundo procedimento do teste.
let procedureCounter = 0
export async function ensureProcedure(overrides = {}) {
  procedureCounter++
  const suffix = `${procedureCounter}`
  const code = overrides.code ?? `PROC-907-${suffix}`
  const existing = await prisma.procedure.findUnique({ where: { code } })
  if (existing) return existing
  return prisma.procedure.create({
    data: {
      name: overrides.name ?? `Procedimento de teste ${suffix}`,
      code,
      category: overrides.category ?? "Restauração",
      defaultPrice: overrides.defaultPrice ?? 250,
      active: overrides.active ?? true,
      allowPriceOverride: overrides.allowPriceOverride ?? true,
    },
  })
}

// Adiciona um item na AGENDA (previsto) do atendimento.
export async function scheduleProcedure(appointmentId, procedure, quantity = 1) {
  return prisma.appointmentProcedure.create({
    data: {
      appointmentId,
      procedureId: procedure.id,
      procedureNameSnapshot: procedure.name,
      unitPrice: procedure.defaultPrice ?? 0,
      quantity,
      totalPrice: (procedure.defaultPrice ?? 0) * quantity,
    },
    select: { id: true, procedureId: true, totalPrice: true },
  })
}

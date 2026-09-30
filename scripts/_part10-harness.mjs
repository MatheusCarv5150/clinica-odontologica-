// ===========================================================================
// HARNESS DOS TESTES DA PARTE 10.
//
// (Plano de Tratamento 10.1 · Prescrição 10.2 · Documentos/Imagens 10.3)
//
// Mesma estratégia dos harnesses anteriores: roda FORA do Next, compila os
// serviços sob demanda com o tsc do projeto e instancia o Prisma Client contra
// um SQLite DESCARTÁVEL criado a partir do schema real. O banco de
// desenvolvimento NUNCA é tocado.
//
// Não executa teste sozinho — quem orquestra é scripts/test-part10.mjs.
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

const outDir = mkdtempSync(path.join(root, ".part10-test-"))
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
// Compilação sob demanda dos serviços
// ---------------------------------------------------------------------------

const SERVICE_SOURCES = [
  "lib/tooth-catalog.ts",
  "lib/date-utils.ts",
  "lib/attendance-status.ts",
  "lib/procedure-execution-domain.ts",
  "lib/odontogram-domain.ts",
  "lib/schemas-odontogram.ts",
  "lib/odontogram-service.ts",
  "lib/treatment-plan-domain.ts",
  "lib/schemas-treatment-plan.ts",
  "lib/treatment-plan-service.ts",
  "lib/prescription-domain.ts",
  "lib/schemas-prescription.ts",
  "lib/prescription-service.ts",
  "lib/document-domain.ts",
  "lib/schemas-documents.ts",
  "lib/document-service.ts",
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

let planService
let planDomain
let planSchemas
let prescriptionService
let prescriptionDomain
let prescriptionSchemas
let documentService
let documentDomain
let documentSchemas
let prisma
let odontogramService

try {
  prepareDatabase()
  process.env.DATABASE_URL = "file:" + dbPath

  compileService()
  const out = path.join(outDir, "out")
  planService = await import(
    pathToFileURL(path.join(out, "lib", "treatment-plan-service.js")).href
  )
  planDomain = await import(
    pathToFileURL(path.join(out, "lib", "treatment-plan-domain.js")).href
  )
  planSchemas = await import(
    pathToFileURL(path.join(out, "lib", "schemas-treatment-plan.js")).href
  )
  prescriptionService = await import(
    pathToFileURL(path.join(out, "lib", "prescription-service.js")).href
  )
  prescriptionDomain = await import(
    pathToFileURL(path.join(out, "lib", "prescription-domain.js")).href
  )
  prescriptionSchemas = await import(
    pathToFileURL(path.join(out, "lib", "schemas-prescription.js")).href
  )
  documentService = await import(
    pathToFileURL(path.join(out, "lib", "document-service.js")).href
  )
  documentDomain = await import(
    pathToFileURL(path.join(out, "lib", "document-domain.js")).href
  )
  documentSchemas = await import(
    pathToFileURL(path.join(out, "lib", "schemas-documents.js")).href
  )
  odontogramService = await import(
    pathToFileURL(path.join(out, "lib", "odontogram-service.js")).href
  )
  const prismaModule = await import(
    pathToFileURL(path.join(out, "lib", "prisma.js")).href
  )
  prisma = prismaModule.prisma
} catch (error) {
  console.error("Não foi possível preparar os serviços para os testes:", error.message)
  rmSync(outDir, { recursive: true, force: true })
  process.exit(1)
}

export {
  planService,
  planDomain,
  planSchemas,
  prescriptionService,
  prescriptionDomain,
  prescriptionSchemas,
  documentService,
  documentDomain,
  documentSchemas,
  odontogramService,
  prisma,
  test,
  section,
  assert,
  outDir,
}

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let cpfCounter = 0
function nextCpf() {
  cpfCounter++
  return String(90800000000 + cpfCounter)
}

export async function createPatient(name = "Paciente Parte 10") {
  return prisma.patient.create({
    data: {
      fullName: name,
      cpf: nextCpf(),
      birthDate: new Date("1985-06-10"),
      phone: "11977776666",
    },
    select: { id: true, fullName: true },
  })
}

export async function createAppointment(patientId, status = "in_progress") {
  return prisma.appointment.create({
    data: {
      patientId,
      appointmentDate: new Date("2026-09-19"),
      appointmentTime: "09:00",
      status,
    },
    select: { id: true, status: true },
  })
}

// Garante um procedimento no catálogo REAL (nome/código únicos por chamada).
let procedureCounter = 0
export async function ensureProcedure(options = {}) {
  procedureCounter++
  const suffix = String(procedureCounter).padStart(3, "0")
  return prisma.procedure.create({
    data: {
      name: `Procedimento Teste ${suffix}`,
      code: `TST10-${suffix}`,
      category: options.category ?? "Restaurador",
      defaultPrice: options.defaultPrice ?? 100,
      allowPriceOverride: options.allowPriceOverride ?? true,
      active: options.active ?? true,
    },
    select: { id: true, name: true, code: true, defaultPrice: true },
  })
}

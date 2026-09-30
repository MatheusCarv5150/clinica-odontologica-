// ===========================================================================
// HARNESS DOS TESTES DE FINALIZAÇÃO DO ATENDIMENTO (Parte 9).
//
// Mesma estratégia dos harnesses anteriores: roda FORA do Next, compila o
// serviço sob demanda com o tsc do projeto e instancia o Prisma Client contra
// um SQLite descartável criado a partir do schema real.
//
// Exercita o SERVIÇO REAL (transação, auditoria, idempotência, concorrência),
// não uma reimplementação das regras.
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

const outDir = mkdtempSync(path.join(root, ".finalization-test-"))
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
  "lib/schemas.ts",
  "lib/date-utils.ts",
  "lib/attendance-status.ts",
  "lib/attendance-finalization-domain.ts",
  "lib/schemas-finalization.ts",
  "lib/attendance-finalization-service.ts",
  // O serviço de finalização resolve a identidade do profissional no cadastro
  // (snapshot congelado), portanto depende do serviço de profissionais e das
  // suas dependências de domínio/schema.
  "lib/professionals-domain.ts",
  "lib/schemas-professionals.ts",
  "lib/professionals-service.ts",
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
let schemas
let prisma

try {
  prepareDatabase()
  process.env.DATABASE_URL = "file:" + dbPath

  compileService()
  const out = path.join(outDir, "out")
  service = await import(
    pathToFileURL(path.join(out, "lib", "attendance-finalization-service.js")).href
  )
  domain = await import(
    pathToFileURL(path.join(out, "lib", "attendance-finalization-domain.js")).href
  )
  schemas = await import(
    pathToFileURL(path.join(out, "lib", "schemas-finalization.js")).href
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

export { service, domain, schemas, prisma, test, section, assert, outDir }

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let cpfCounter = 0
function nextCpf() {
  cpfCounter++
  return String(90800000000 + cpfCounter)
}

let procedureCounter = 0

export async function createPatient(name = "Paciente Finalização") {
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
      appointmentDate: new Date("2026-09-19"),
      appointmentTime: "18:32",
      status,
      // Só os atendimentos já iniciados têm started_at (espelha a Part 1).
      ...(status === "in_progress"
        ? { startedAt: new Date(Date.now() - 47 * 60 * 1000) }
        : {}),
    },
    select: { id: true, status: true },
  })
}

export async function ensureProcedure() {
  procedureCounter++
  const suffix = String(procedureCounter)
  return prisma.procedure.create({
    data: {
      name: `Procedimento finalização ${suffix}`,
      code: `FIM-908-${suffix}`,
      category: "Restauração",
      defaultPrice: 250,
      active: true,
      allowPriceOverride: true,
    },
  })
}

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
    select: { id: true },
  })
}

// Cria o registro clínico (Parte 6) com os campos obrigatórios preenchidos.
export async function createEvolutionRecord(appointmentId, patientId, overrides = {}) {
  return prisma.appointmentEvolution.create({
    data: {
      appointmentId,
      patientId,
      chiefComplaint: overrides.chiefComplaint ?? "Dor no dente 26.",
      clinicalFindings: overrides.clinicalFindings ?? "Lesão cariosa oclusal no 26.",
      evaluation: overrides.evaluation ?? "Cárie dentinária.",
      conduct: overrides.conduct ?? "Restauração em resina.",
      evolution: overrides.evolution ?? "Paciente evoluiu bem.",
      intercurrentHas: overrides.intercurrentHas ?? false,
      intercurrentDesc: overrides.intercurrentDesc ?? null,
      finalized: false,
    },
  })
}

export async function registerExecution(appointmentId, patientId, procedureId, overrides = {}) {
  return prisma.appointmentProcedureExecution.create({
    data: {
      appointmentId,
      patientId,
      procedureId,
      procedureNameSnapshot: overrides.procedureNameSnapshot ?? "Procedimento",
      origin: overrides.origin ?? "added_in_attendance",
      status: overrides.status ?? "performed",
      toothNumber: overrides.toothNumber ?? null,
      surfaces: overrides.surfaces ?? "",
      performedPrice: overrides.performedPrice ?? null,
      performedAt: overrides.status === "performed" ? new Date() : null,
    },
    select: { id: true },
  })
}

export async function createOdontogramEvent(appointmentId, patientId, overrides = {}) {
  return prisma.odontogramEvent.create({
    data: {
      appointmentId,
      patientId,
      toothNumber: overrides.toothNumber ?? "26",
      dentition: overrides.dentition ?? "permanent",
      kind: overrides.kind ?? "condition",
      code: overrides.code ?? "caries",
      labelSnapshot: overrides.labelSnapshot ?? "Cárie",
      surfaces: overrides.surfaces ?? "O",
      status: overrides.status ?? "active",
    },
    select: { id: true },
  })
}

export async function createAnamnesis(appointmentId, patientId) {
  return prisma.anamnesis.create({
    data: { appointmentId, patientId },
    select: { id: true },
  })
}

export async function getFinalizationLogs(appointmentId) {
  return prisma.appointmentFinalizationLog.findMany({
    where: { appointmentId },
    orderBy: { createdAt: "asc" },
  })
}

export async function getAppointment(id) {
  return prisma.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      finishedById: true,
      finishedByName: true,
    },
  })
}

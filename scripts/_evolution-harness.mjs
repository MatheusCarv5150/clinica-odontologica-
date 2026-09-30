// ===========================================================================
// HARNESS DOS TESTES DA EVOLUÇÃO CRONOLÓGICA (Parte 8).
//
// Mesma estratégia dos harnesses das partes anteriores: roda FORA do Next,
// compila os serviços sob demanda com o tsc do projeto e instancia o Prisma
// Client contra um SQLite descartável criado a partir do schema real.
//
// Importante: o serviço da timeline é SOMENTE LEITURA. Os testes criam os
// registros clínicos pelas tabelas REAIS (Appointment, AppointmentEvolution,
// procedimentos, odontograma) exatamente como as partes 4–7 fariam — sem
// depender de caminhos de escrita que a Parte 8 não possui.
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

const outDir = mkdtempSync(path.join(root, ".evolution-test-"))
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

// Fontes compiladas junto: o serviço da timeline depende do catálogo de dentes
// (superfícies) e dos helpers de data/status.
const SERVICE_SOURCES = [
  "lib/tooth-catalog.ts",
  "lib/date-utils.ts",
  "lib/attendance-status.ts",
  "lib/evolution-timeline.ts",
  "lib/evolution-timeline-service.ts",
  "lib/attendance-detail-service.ts",
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
        const withExt = target.endsWith(".js") ? target : target + ".js"
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

let domain
let service
let detailService
let prisma

try {
  prepareDatabase()
  process.env.DATABASE_URL = "file:" + dbPath

  compileService()
  const out = path.join(outDir, "out")
  domain = await import(
    pathToFileURL(path.join(out, "lib", "evolution-timeline.js")).href
  )
  service = await import(
    pathToFileURL(path.join(out, "lib", "evolution-timeline-service.js")).href
  )
  detailService = await import(
    pathToFileURL(path.join(out, "lib", "attendance-detail-service.js")).href
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

export { domain, service, detailService, prisma, test, section, assert, outDir }

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
// Fixtures — criam registros pelas tabelas REAIS
// ---------------------------------------------------------------------------

let cpfCounter = 0
function nextCpf() {
  cpfCounter++
  return String(90800000000 + cpfCounter)
}

export async function createPatient(name = "Paciente Evolução") {
  return prisma.patient.create({
    data: {
      fullName: name,
      cpf: nextCpf(),
      birthDate: new Date("1975-05-10"),
      phone: "11977776666",
    },
    select: { id: true, fullName: true },
  })
}

// Cria um atendimento em uma data/hora específica. O status é parametrizável
// para exercitar todos os casos de classificação (documentado, rascunho,
// incompleto, cancelado, não compareceu, agendado).
export async function createAppointment(
  patientId,
  { date = "2026-09-15", time = "10:00", status = "completed" } = {},
) {
  return prisma.appointment.create({
    data: {
      patientId,
      appointmentDate: new Date(date),
      appointmentTime: time,
      status,
    },
    select: { id: true, status: true },
  })
}

let procedureCounter = 0
export async function createProcedure(overrides = {}) {
  procedureCounter++
  const suffix = String(procedureCounter)
  return prisma.procedure.create({
    data: {
      name: overrides.name ?? `Procedimento evolução ${suffix}`,
      code: overrides.code ?? `EVO-${suffix}`,
      category: overrides.category ?? "Restauração",
      defaultPrice: overrides.defaultPrice ?? 200,
      active: true,
      allowPriceOverride: true,
    },
  })
}

// Registro clínico do atendimento (Parte 6).
export async function createEvolutionRecord(
  appointmentId,
  patientId,
  overrides = {},
) {
  return prisma.appointmentEvolution.create({
    data: {
      appointmentId,
      patientId,
      chiefComplaint: overrides.chiefComplaint ?? "Dor no dente 26",
      clinicalFindings: overrides.clinicalFindings ?? "Lesão cariosa em 26 O",
      evaluation: overrides.evaluation ?? "Lesão cariosa em dente 26",
      conduct: overrides.conduct ?? "Realizada restauração",
      evolution: overrides.evolution ?? "Paciente apresentou boa tolerância.",
      guidance: overrides.guidance ?? null,
      intercurrentHas: overrides.intercurrentHas ?? false,
      intercurrentDesc: overrides.intercurrentDesc ?? null,
      observations: overrides.observations ?? null,
      finalized: overrides.finalized ?? true,
      finalizedAt: overrides.finalized ? new Date() : null,
      finalizedByName: overrides.finalizedByName ?? "Dr. João da Silva",
      createdByName: overrides.createdByName ?? "Dr. João da Silva",
    },
    select: { id: true },
  })
}

// Execução de procedimento (Parte 7).
export async function createExecution(appointmentId, patientId, procedureId, overrides = {}) {
  return prisma.appointmentProcedureExecution.create({
    data: {
      appointmentId,
      patientId,
      procedureId,
      procedureNameSnapshot: overrides.name ?? "Restauração em resina",
      procedureCodeSnapshot: overrides.code ?? "RES-01",
      origin: overrides.origin ?? "scheduled",
      status: overrides.status ?? "performed",
      toothNumber: overrides.toothNumber ?? "26",
      dentition: overrides.dentition ?? "permanent",
      surfaces: overrides.surfaces ?? "O",
      performedPrice: overrides.performedPrice ?? 200,
      professionalName: overrides.professionalName ?? "Dr. João da Silva",
      notes: overrides.notes ?? null,
    },
    select: { id: true },
  })
}

// Evento do odontograma (Parte 5).
export async function createOdontogramEvent(
  appointmentId,
  patientId,
  overrides = {},
) {
  return prisma.odontogramEvent.create({
    data: {
      appointmentId,
      patientId,
      toothNumber: overrides.toothNumber ?? "36",
      dentition: overrides.dentition ?? "permanent",
      kind: overrides.kind ?? "condition",
      code: overrides.code ?? "caries",
      labelSnapshot: overrides.labelSnapshot ?? "Cárie",
      surfaces: overrides.surfaces ?? "M",
      status: overrides.status ?? "active",
      professionalName: overrides.professionalName ?? "Dr. João da Silva",
    },
    select: { id: true },
  })
}

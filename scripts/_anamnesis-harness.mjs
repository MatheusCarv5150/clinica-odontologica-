// ===========================================================================
// HARNESS dos testes de integração da ANAMNESE (Parte 4).
//
// Prepara o ambiente (carrega .env, resolve o caminho absoluto do SQLite,
// compila o serviço sob demanda e instancia o Prisma Client) e expõe os
// utilitários usados pelos arquivos de cenário.
//
// Não executa nenhum teste sozinho — quem orquestra é scripts/test-anamnesis.mjs.
// ===========================================================================

import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")

// ---------------------------------------------------------------------------
// Carregamento do .env (o script roda fora do Next, que faria isso sozinho).
// Sem isto o Prisma Client não resolve DATABASE_URL e cai no banco errado.
// ---------------------------------------------------------------------------

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

// O caminho relativo do SQLite (ex.: "file:./dev.db") é resolvido pelo Prisma
// a partir da pasta do schema. Um script solto na raiz resolveria para outro
// arquivo (vazio), então fixamos o caminho absoluto aqui.
if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("file:./")) {
  const relative = process.env.DATABASE_URL.slice("file:./".length)
  process.env.DATABASE_URL = "file:" + path.join(root, "prisma", relative)
}

// ---------------------------------------------------------------------------
// Compilação sob demanda do serviço (e suas dependências internas)
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(path.join(root, ".anamnesis-test-"))

const SERVICE_SOURCES = [
  "lib/anamnesis-domain.ts",
  "lib/schemas-anamnesis.ts",
  "lib/anamnesis-service.ts",
  "lib/prisma.ts",
]

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

  // O tsc NÃO reescreve o alias "@/..." no JavaScript emitido (paths só valem
  // para checagem de tipos). Reescrevemos os especificadores para caminhos
  // relativos reais e acrescentamos a extensão ".js", que o Node ESM exige.
  const outRoot = path.join(outDir, "out")
  for (const file of walk(outRoot)) {
    if (!file.endsWith(".js")) continue
    const original = readFileSync(file, "utf8")
    const rewritten = original.replace(
      /(from\s+|import\s*\(\s*)(["'])(@\/[^"']+|\.[^"']*)\2/g,
      (_match, prefix, quote, spec) => {
        let target
        const resolved = spec.startsWith("@/") ? spec.slice(2) : spec
        if (spec.startsWith("@/")) {
          target = path.join(outRoot, resolved)
        } else {
          target = path.resolve(path.dirname(file), spec)
        }
        if (!target.endsWith(".js")) target += ".js"
        let relative = path.relative(path.dirname(file), target).replace(/\\/g, "/")
        if (!relative.startsWith(".")) relative = "./" + relative
        return `${prefix}${quote}${relative}${quote}`
      },
    )
    if (rewritten !== original) writeFileSync(file, rewritten)
  }
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
let prisma

try {
  compileService()
  const out = path.join(outDir, "out")
  service = await import(pathToFileURL(path.join(out, "lib", "anamnesis-service.js")).href)
  const prismaModule = await import(pathToFileURL(path.join(out, "lib", "prisma.js")).href)
  prisma = prismaModule.prisma
} catch (error) {
  console.error("Não foi possível preparar o serviço para os testes:", error.message)
  rmSync(outDir, { recursive: true, force: true })
  process.exit(1)
}

export { service, prisma, test, section, assert, outDir }

// ---------------------------------------------------------------------------
// Contadores e relatório final
// ---------------------------------------------------------------------------

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

// CPFs reservados — sempre limpos antes e depois, para o teste ser idempotente.
const TEST_CPFS = ["90500000001", "90500000002", "90500000003"]

export async function purgeTestData() {
  const patients = await prisma.patient.findMany({
    where: { cpf: { in: TEST_CPFS } },
    select: { id: true },
  })
  const patientIds = patients.map((p) => p.id)
  if (patientIds.length === 0) return

  await prisma.anamnesisChangeLog.deleteMany({ where: { patientId: { in: patientIds } } })
  await prisma.anamnesisRecordItem.deleteMany({
    where: { record: { patientId: { in: patientIds } } },
  })
  await prisma.anamnesisAnswer.deleteMany({
    where: { record: { patientId: { in: patientIds } } },
  })
  await prisma.anamnesisSessionAnswer.deleteMany({
    where: { anamnesis: { patientId: { in: patientIds } } },
  })
  await prisma.anamnesis.deleteMany({ where: { patientId: { in: patientIds } } })
  await prisma.anamnesisRecord.deleteMany({ where: { patientId: { in: patientIds } } })
  await prisma.appointment.deleteMany({ where: { patientId: { in: patientIds } } })
  await prisma.patient.deleteMany({ where: { id: { in: patientIds } } })
}

export async function createPatient(name, cpf) {
  return prisma.patient.create({
    data: {
      fullName: name,
      cpf,
      birthDate: new Date("1985-06-15"),
      phone: "11999999999",
    },
    select: { id: true, fullName: true },
  })
}

export async function createAppointment(patientId, date) {
  return prisma.appointment.create({
    data: {
      patientId,
      appointmentDate: new Date(date),
      appointmentTime: "09:00",
      status: "in_progress",
    },
    select: { id: true },
  })
}

// Payload base do perfil clínico (tudo vazio é válido — estado "sem dados").
export function clinical(overrides = {}) {
  return {
    answers: [],
    conditions: [],
    allergies: [],
    medications: [],
    surgeries: [],
    notes: null,
    ...overrides,
  }
}

export function session(overrides = {}) {
  return { sessionAnswers: [], ...overrides }
}

export function item(type, label, extra = {}) {
  return { type, label, ...extra }
}

export function structuredAnswer(questionKey, sectionName, value, note = null) {
  return { questionKey, section: sectionName, value, note }
}

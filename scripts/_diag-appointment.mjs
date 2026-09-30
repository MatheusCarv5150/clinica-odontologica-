// DIAGNÓSTICO TEMPORÁRIO — descobrir por que o create de appointment falha
// nas fixtures de teste de Contas a Receber.
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const outDir = mkdtempSync(path.join(root, ".diag-"))
const dbPath = path.join(outDir, "test.db")

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
  { stdio: "pipe", env: { ...process.env, DATABASE_URL: "file:" + dbPath } }
)

process.env.DATABASE_URL = "file:" + dbPath

const { PrismaClient } = await import(
  pathToFileURL(path.join(root, "node_modules", "@prisma", "client", "index.js")).href
)

const prisma = new PrismaClient()

const patient = await prisma.patient.create({
  data: {
    fullName: "Diag",
    cpf: "12345678901",
    birthDate: new Date(1990, 0, 1),
  },
  select: { id: true },
})

try {
  const created = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      appointmentDate: new Date(2026, 8, 10),
      appointmentTime: "09:00",
      status: "completed",
      totalAmount: 550,
      finishedByName: null,
      procedures: {
        create: [
          {
            procedureId: null,
            procedureNameSnapshot: "Limpeza",
            quantity: 1,
            unitPrice: 150,
            totalPrice: 150,
          },
        ],
      },
    },
    select: { id: true },
  })
  console.log("OK appointment:", created.id)
} catch (error) {
  console.log("FALHOU:")
  console.log(error.message)
}

await prisma.$disconnect()

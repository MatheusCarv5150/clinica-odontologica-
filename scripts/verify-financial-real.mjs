// ===========================================================================
// VERIFICAÇÃO DO DASHBOARD CONTRA O BANCO DE DESENVOLVIMENTO REAL.
//
// Reaproveita a infra de compilação do harness de testes, mas aponta para o
// banco REAL do .env. Apenas LÊ: nenhuma escrita é feita. Conferimos que o
// dashboard projeta os dados reais e que os alertas apontam divergências
// verdadeiras (nunca falsos positivos).
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

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")

// --- .env ------------------------------------------------------------------
for (const line of readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) continue
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed)
  if (!m) continue
  let value = m[2].trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  process.env[m[1]] = value
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("DATABASE_URL ausente no .env")
  process.exit(1)
}
console.log("Banco:", DATABASE_URL.replace(/:[^:@/]+@/, ":****@"))

// --- compila os serviços ---------------------------------------------------
const outDir = mkdtempSync(path.join(root, ".fin-real-"))
const SERVICE_SOURCES = [
  "lib/schemas.ts",
  "lib/date-utils.ts",
  "lib/prisma.ts",
  "lib/financial-domain.ts",
  "lib/financial-service.ts",
  "lib/financial-expense-service.ts",
  "lib/financial-dashboard-service.ts",
  "lib/schemas-financial.ts",
]

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function compile() {
  writeFileSync(
    path.join(outDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ES2022",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          verbatimModuleSyntax: false,
          baseUrl: "./src",
          paths: { "@/*": ["./*"] },
          outDir: "out",
          rootDir: "src",
        },
        include: ["src/**/*.ts"],
      },
      null,
      2
    )
  )
  mkdirSync(path.join(outDir, "src", "lib"), { recursive: true })
  for (const rel of SERVICE_SOURCES) {
    writeFileSync(
      path.join(outDir, "src", rel),
      readFileSync(path.join(root, "src", rel), "utf8")
    )
  }
  execFileSync(
    process.execPath,
    [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", outDir],
    { stdio: "pipe" }
  )

  const outRoot = path.join(outDir, "out")
  for (const file of walk(outRoot)) {
    if (!file.endsWith(".js")) continue
    const original = readFileSync(file, "utf8")
    const rewritten = original.replace(
      /(from\s+|import\s*\(\s*)(["'])(@\/[^"']+|\.[^"']*)\2/g,
      (_m, prefix, quote, spec) => {
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

let db
let failures = 0

function check(label, condition, detail) {
  if (condition) {
    console.log(`  OK   ${label}`)
  } else {
    failures++
    console.log(`  FALHA ${label}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}

try {
  compile()

  const prismaMod = await import("@prisma/client")
  db = new prismaMod.PrismaClient({ datasources: { db: { url: DATABASE_URL } } })

  const { getFinancialDashboard } = await import(
    pathToFileURL(path.join(outDir, "out", "lib", "financial-dashboard-service.js")).href
  )
  const { roundMoney } = await import(
    pathToFileURL(path.join(outDir, "out", "lib", "financial-domain.js")).href
  )

  const now = new Date()
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`
  const monthStart = iso(new Date(now.getFullYear(), now.getMonth(), 1))
  const monthEnd = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  const startLocal = new Date(now.getFullYear(), now.getMonth(), 1)
  const endLocal = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  console.log(`\nPeríodo: mês corrente (${monthStart} .. ${monthEnd})\n`)

  const dashboard = await getFinancialDashboard({
    preset: "custom",
    from: monthStart,
    to: monthEnd,
  })

  const previsto =
    roundMoney(dashboard.cash.received + dashboard.cash.expectedIn) -
    roundMoney(dashboard.cash.paid + dashboard.cash.expectedOut)

  console.log("--- Totais ---")
  console.log("  recebido (efetivado): ", dashboard.cash.received)
  console.log("  previsto a receber:   ", dashboard.cash.expectedIn)
  console.log("  pago (efetivado):     ", dashboard.cash.paid)
  console.log("  previsto a pagar:     ", dashboard.cash.expectedOut)
  console.log("  resultado do caixa:   ", dashboard.cash.net)
  console.log("  resultado projetado:  ", dashboard.cash.projectedNet)
  console.log(
    "  a receber:            ",
    dashboard.accountsReceivable.total,
    `(${dashboard.accountsReceivable.count} atendimentos)`
  )
  console.log("  entradas:             ", dashboard.income.total)
  console.log("  saídas:               ", dashboard.expense.total)

  const allTotals = [
    dashboard.cash.received,
    dashboard.cash.paid,
    dashboard.cash.expectedIn,
    dashboard.cash.expectedOut,
    dashboard.cash.net,
    dashboard.cash.projectedNet,
    dashboard.accountsReceivable.total,
    dashboard.income.total,
    dashboard.expense.total,
  ]
  check("nenhum total é NaN/Infinity", allTotals.every((n) => Number.isFinite(n)))
  check("nenhum total é negativo", allTotals.every((n) => n >= 0))
  check(
    "resultado do caixa = recebido - pago",
    dashboard.cash.net === roundMoney(dashboard.cash.received - dashboard.cash.paid)
  )
  check(
    "resultado projetado = projetado - projetado",
    dashboard.cash.projectedNet === previsto
  )

  // --- cruzamento com dados brutos do banco --------------------------------
  const [paymentsPaid, expensesPaid] = await Promise.all([
    db.payment.aggregate({
      _sum: { amount: true },
      where: { status: "paid", paidAt: { gte: startLocal, lte: endLocal } },
    }),
    db.expense.aggregate({
      _sum: { amount: true },
      where: { status: "paid", competenceDate: { gte: startLocal, lte: endLocal } },
    }),
  ])
  const bankIn = paymentsPaid._sum.amount ?? 0
  const bankOut = expensesPaid._sum.amount ?? 0

  console.log("\n--- Conferência contra o banco ---")
  console.log("  pagamentos pagos (banco):", bankIn)
  console.log("  despesas pagas (banco):  ", bankOut)

  check(
    "recebido bate com os pagamentos pagos do período",
    Math.abs(dashboard.cash.received - bankIn) < 0.005,
    `dashboard=${dashboard.cash.received} banco=${bankIn}`
  )
  check(
    "pago bate com as despesas pagas do período",
    Math.abs(dashboard.cash.paid - bankOut) < 0.005,
    `dashboard=${dashboard.cash.paid} banco=${bankOut}`
  )

  // --- série temporal ------------------------------------------------------
  const points = dashboard.series.points
  const first = points[0]
  const last = points[points.length - 1]
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  console.log("\n--- Série temporal ---")
  console.log("  granularidade:", dashboard.series.granularity)
  console.log("  pontos:", points.length, "de", first?.key, "a", last?.key)
  check("série começa no início do período", first?.key === monthStart)
  check("série termina no fim do período", last?.key === monthEnd)
  check("série cobre todos os dias do mês", points.length === daysInMonth)
  check(
    "cada ponto é consistente (líquido = entradas - saídas)",
    points.every((p) => p.net === roundMoney(p.income - p.expense))
  )

  // A série soma TODAS as movimentações não canceladas/estornadas do período
  // (efetivadas + previstas), então precisa fechar com a soma bruta do banco.
  const [allIn, allOut] = await Promise.all([
    db.financialTransaction.aggregate({
      _sum: { amount: true },
      where: {
        direction: "in",
        status: { notIn: ["cancelled", "reversed"] },
        competenceDate: { gte: startLocal, lte: endLocal },
      },
    }),
    db.financialTransaction.aggregate({
      _sum: { amount: true },
      where: {
        direction: "out",
        status: { notIn: ["cancelled", "reversed"] },
        competenceDate: { gte: startLocal, lte: endLocal },
      },
    }),
  ])

  const seriesIn = roundMoney(points.reduce((s, p) => s + p.income, 0))
  const seriesOut = roundMoney(points.reduce((s, p) => s + p.expense, 0))
  check(
    "soma da série (entradas) fecha com as movimentações do banco",
    seriesIn === roundMoney(allIn._sum.amount ?? 0),
    `série=${seriesIn} banco=${roundMoney(allIn._sum.amount ?? 0)}`
  )
  check(
    "soma da série (saídas) fecha com as movimentações do banco",
    seriesOut === roundMoney(allOut._sum.amount ?? 0),
    `série=${seriesOut} banco=${roundMoney(allOut._sum.amount ?? 0)}`
  )

  // --- integridade: alertas devem ser verdadeiros ---------------------------
  const integ = dashboard.integrity
  console.log("\n--- Integridade ---")
  console.log("  divergências declarado x procedimentos:", integ.declaredVsProceduresMismatch.length)
  console.log("  atendimentos com excedente:", integ.overpaidAppointments.length)

  let allReal = true
  for (const d of integ.declaredVsProceduresMismatch) {
    const appt = await db.appointment.findUnique({
      where: { id: d.appointmentId },
      select: {
        totalAmount: true,
        procedures: { select: { totalPrice: true } },
      },
    })
    if (!appt) {
      allReal = false
      console.log(`    -> atendimento ${d.appointmentId} NÃO EXISTE no banco`)
      continue
    }
    const declared = appt.totalAmount ?? 0
    const procedures = appt.procedures.reduce((s, p) => s + p.totalPrice, 0)
    if (Math.abs(declared - procedures) < 0.005) {
      allReal = false
      console.log(
        `    -> falso positivo ${d.appointmentId}: declarado=${declared} procedimentos=${procedures}`
      )
    } else {
      console.log(
        `    ok ${d.appointmentId} (${d.patientName}): declarado=${declared} procedimentos=${procedures}`
      )
    }
  }
  check("toda divergência listada é real (sem falso positivo)", allReal)

  // Cada excedente listado também deve ser conferível: a soma dos pagamentos
  // efetivados precisa ultrapassar o previsto do atendimento.
  let overpaidReal = true
  for (const o of integ.overpaidAppointments) {
    const appt = await db.appointment.findUnique({
      where: { id: o.appointmentId },
      select: {
        totalAmount: true,
        payments: { select: { amount: true, status: true } },
        procedures: { select: { totalPrice: true } },
      },
    })
    if (!appt) {
      overpaidReal = false
      console.log(`    -> atendimento ${o.appointmentId} NÃO EXISTE no banco`)
      continue
    }
    const paid = appt.payments
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + p.amount, 0)
    const expected =
      appt.totalAmount ?? appt.procedures.reduce((s, p) => s + p.totalPrice, 0)
    if (paid <= expected + 0.005) {
      overpaidReal = false
      console.log(
        `    -> falso positivo ${o.appointmentId}: pago=${paid} previsto=${expected}`
      )
    } else {
      console.log(`    ok ${o.appointmentId} (${o.patientName}): pago=${paid} previsto=${expected}`)
    }
  }
  check("todo excedente listado é real (sem falso positivo)", overpaidReal)

  console.log("\n----------------------------------------")
  console.log(
    failures === 0
      ? "Dashboard confere com o banco real."
      : `${failures} verificação(ões) falharam.`
  )
  console.log("----------------------------------------")
} catch (error) {
  console.error("\nErro na verificação:", error)
  failures++
} finally {
  if (db) await db.$disconnect()
  rmSync(outDir, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
}

// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — FECHAMENTO FINANCEIRO (Financeiro 6).
// ===========================================================================
//
// Exercita o SERVIÇO REAL (`financial-closing-service`) contra um SQLite
// descartável. Cobre validação, fechamento com SNAPSHOT, histórico, auditoria,
// detecção de alteração retroativa e reabertura.
//
// REGRAS QUE ESTES TESTES PROTEGEM
//   - fechar NÃO apaga nem bloqueia dados (não há exclusão destrutiva);
//   - o snapshot congela os números REAIS do período (serviços canônicos);
//   - não é possível ter dois fechamentos ATIVOS sobre o MESMO período;
//   - alteração retroativa é DETECTADA (comparação snapshot x atual);
//   - reabertura EXIGE motivo e é registrada em auditoria;
//   - a trilha de auditoria preserva fechamento E reabertura.

import { prisma, closingService, test, section, assert } from "./_financial-harness.mjs"

const {
  validateClosing,
  closePeriod,
  reopenPeriod,
  getClosingDetail,
  listClosings,
  isPeriodClosed,
} = closingService

let seq = 0
const uniq = () => `${Date.now()}-${++seq}`

function localDate(iso) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function today() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function shiftDays(days, base = today()) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

function isoDay(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Período exclusivo por teste, evitando colisão com @@unique(periodStart,periodEnd). */
function uniquePeriod() {
  // Baseia-se num dia distante no passado + offset aleatório para garantir
  // unicidade entre execuções sem tocar nos dados do "mundo" do período atual.
  const base = new Date(2000, 0, 1)
  base.setDate(base.getDate() + (Date.now() % 3000) + seq * 3)
  return { from: isoDay(base), to: isoDay(base) }
}

async function makeUniquePatient(prefix = "Fecha") {
  return prisma.patient.create({
    data: {
      fullName: `${prefix} ${uniq()}`,
      cpf: (String(Date.now()) + String(seq++)).slice(-11).padStart(11, "0"),
      birthDate: localDate("1990-01-01"),
    },
    select: { id: true, fullName: true },
  })
}

async function makeAppointment(options = {}) {
  const patient = options.patient ?? (await makeUniquePatient())
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      appointmentDate: options.date ?? today(),
      appointmentTime: "10:00",
      status: "completed",
      totalAmount: options.totalAmount ?? 0,
    },
    select: { id: true },
  })
  return { appointment, patient }
}

async function pay(appointmentId, options = {}) {
  return prisma.payment.create({
    data: {
      appointmentId,
      amount: options.amount ?? 100,
      paymentMethod: options.paymentMethod ?? "pix",
      status: options.status ?? "paid",
      paidAt: options.paidAt === null ? null : options.paidAt ?? today(),
      createdAt: options.createdAt ?? today(),
    },
    select: { id: true },
  })
}

async function makeCategory() {
  return prisma.expenseCategory.create({
    data: { name: `Cat ${uniq()}`, kind: "material", system: false },
    select: { id: true },
  })
}

async function makeExpense(options = {}) {
  const categoryId = options.categoryId ?? (await makeCategory()).id
  return prisma.expense.create({
    data: {
      categoryId,
      description: options.description ?? `Despesa ${uniq()}`,
      supplier: "Fornecedor Fecha",
      amount: options.amount ?? 200,
      status: "pending",
      competenceDate: options.competenceDate ?? today(),
      dueDate: options.dueDate ?? null,
    },
    select: { id: true },
  })
}

async function payExpense(expenseId, options = {}) {
  return prisma.expensePayment.create({
    data: {
      expenseId,
      amount: options.amount ?? 200,
      paymentMethod: "pix",
      paidAt: options.paidAt ?? today(),
    },
    select: { id: true },
  })
}

export async function runClosingScenarios() {
  // -------------------------------------------------------------------------
  section("A. Validação pré-fechamento")
  // -------------------------------------------------------------------------

  await test("1. valida período com movimentação e devolve preview", async () => {
    const patient = await makeUniquePatient("Valida")
    const { appointment } = await makeAppointment({ patient, totalAmount: 500 })
    await pay(appointment.id, { amount: 500, paidAt: today() })

    const period = { from: isoDay(today()), to: isoDay(today()) }
    const v = await validateClosing(period.from, period.to)
    assert.ok(!("error" in v))
    assert.equal(typeof v.canClose, "boolean")
    assert.ok(Array.isArray(v.checks))
    assert.ok(v.preview.income >= 500)
  })

  await test("2. período invertido é rejeitado (bloqueio na validação)", async () => {
    const v = await validateClosing("2030-12-31", "2030-01-01")
    assert.ok(!("error" in v))
    assert.equal(v.canClose, false)
    const invalid = v.checks.find((c) => c.code === "PERIOD_INVALID")
    assert.ok(invalid, "deve haver uma checagem PERIOD_INVALID")
    assert.equal(invalid.blocking, true)
  })

  // -------------------------------------------------------------------------
  section("B. Fechamento e snapshot")
  // -------------------------------------------------------------------------

  await test("3. fecha período e congela snapshot dos números reais", async () => {
    const patient = await makeUniquePatient("Snapshot")
    const { appointment } = await makeAppointment({ patient, totalAmount: 1000 })
    await pay(appointment.id, { amount: 700, paidAt: today() })
    const expense = await makeExpense({ amount: 300 })
    await payExpense(expense.id, { amount: 300, paidAt: today() })

    const period = { from: isoDay(today()), to: isoDay(today()) }
    const result = await closePeriod({
      from: period.from,
      to: period.to,
      notes: "Fechamento de teste",
      actor: { userId: null, name: "Testador" },
    })
    assert.ok(!("error" in result), result.error)
    assert.equal(result.status, "closed")
    // Resultado do snapshot = recebido - pago do período (inclui o mundo).
    assert.equal(
      result.snapshot.result,
      Math.round((result.snapshot.income - result.snapshot.expense) * 100) / 100
    )
    assert.ok(result.snapshot.income >= 700)
    assert.ok(result.snapshot.expense >= 300)
    assert.equal(result.notes, "Fechamento de teste")
    assert.equal(result.closedByName, "Testador")
  })

  await test("4. fechar NÃO apaga os pagamentos originais", async () => {
    const before = await prisma.payment.count()
    const patient = await makeUniquePatient("Preserva")
    const { appointment } = await makeAppointment({ patient, totalAmount: 100 })
    await pay(appointment.id, { amount: 100, paidAt: today() })
    const before2 = await prisma.payment.count()

    const period = uniquePeriod()
    await closePeriod({ from: period.from, to: period.to })

    const after = await prisma.payment.count()
    assert.equal(after, before2)
    assert.ok(after >= before)
  })

  await test("5. não permite dois fechamentos ativos sobre o MESMO período", async () => {
    const period = uniquePeriod()
    const first = await closePeriod({ from: period.from, to: period.to })
    assert.ok(!("error" in first), first.error)

    const second = await closePeriod({ from: period.from, to: period.to })
    assert.ok("error" in second, "o segundo fechamento deveria ser bloqueado")
    assert.equal(second.status, 409)
  })

  await test("6. isPeriodClosed reconhece período fechado", async () => {
    const period = uniquePeriod()
    await closePeriod({ from: period.from, to: period.to })
    assert.equal(await isPeriodClosed(period.from, period.to), true)
    const open = uniquePeriod()
    assert.equal(await isPeriodClosed(open.from, open.to), false)
  })

  // -------------------------------------------------------------------------
  section("C. Detecção de alteração retroativa")
  // -------------------------------------------------------------------------

  await test("7. alteração retroativa é DETECTADA (snapshot x atual)", async () => {
    // Período passado exclusivo para o teste.
    const base = new Date(2015, 5, 15)
    const from = isoDay(base)
    const to = isoDay(base)

    const closed = await closePeriod({ from, to })
    assert.ok(!("error" in closed), closed.error)
    assert.equal(closed.comparison.hasChanges, false)

    // Altera retroativamente: adiciona um pagamento dentro daquele período.
    const patient = await makeUniquePatient("Retroativo")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 999,
      date: base,
    })
    await pay(appointment.id, { amount: 999, paidAt: base, createdAt: base })

    const detail = await getClosingDetail(closed.id)
    assert.ok(detail)
    assert.equal(detail.comparison.hasChanges, true)
    const incomeLine = detail.comparison.lines.find((l) => l.field === "income")
    assert.ok(incomeLine)
    assert.ok(incomeLine.difference >= 999 - 1)
    assert.equal(incomeLine.changed, true)
  })

  // -------------------------------------------------------------------------
  section("D. Histórico e auditoria")
  // -------------------------------------------------------------------------

  await test("8. histórico lista e detalhe traz trilha de auditoria", async () => {
    const period = uniquePeriod()
    const closed = await closePeriod({
      from: period.from,
      to: period.to,
      actor: { userId: null, name: "Auditor" },
    })
    assert.ok(!("error" in closed), closed.error)

    const list = await listClosings({ page: 1, pageSize: 100 })
    assert.ok(list.closings.some((c) => c.id === closed.id))

    const detail = await getClosingDetail(closed.id)
    assert.ok(detail)
    assert.ok(detail.logs.length >= 1)
    const closedLog = detail.logs.find((l) => l.event === "closed")
    assert.ok(closedLog)
    assert.equal(closedLog.performedByName, "Auditor")
  })

  // -------------------------------------------------------------------------
  section("E. Reabertura")
  // -------------------------------------------------------------------------

  await test("9. reabrir EXIGE motivo", async () => {
    const period = uniquePeriod()
    const closed = await closePeriod({ from: period.from, to: period.to })
    assert.ok(!("error" in closed), closed.error)

    const noReason = await reopenPeriod(closed.id, "")
    assert.ok("error" in noReason, "reabrir sem motivo deve ser bloqueado")
    assert.equal(noReason.status, 400)
  })

  await test("10. reabrir registra motivo e preserva o fechamento original", async () => {
    const period = uniquePeriod()
    const closed = await closePeriod({
      from: period.from,
      to: period.to,
      actor: { userId: null, name: "Fechador" },
    })
    assert.ok(!("error" in closed), closed.error)

    const reopened = await reopenPeriod(closed.id, "Correção de lançamento", {
      userId: null,
      name: "Reabridor",
    })
    assert.ok(!("error" in reopened), reopened.error)
    assert.equal(reopened.status, "reopened")
    assert.equal(reopened.reopenReason, "Correção de lançamento")
    assert.equal(reopened.reopenedByName, "Reabridor")
    // O snapshot original permanece.
    assert.equal(reopened.snapshot.income, closed.snapshot.income)

    const detail = await getClosingDetail(closed.id)
    assert.ok(detail)
    const reopenedLog = detail.logs.find((l) => l.event === "reopened")
    assert.ok(reopenedLog)
    assert.equal(reopenedLog.reason, "Correção de lançamento")
  })

  await test("11. período reaberto deixa de contar como fechado", async () => {
    const period = uniquePeriod()
    const closed = await closePeriod({ from: period.from, to: period.to })
    assert.ok(!("error" in closed), closed.error)
    assert.equal(await isPeriodClosed(period.from, period.to), true)

    await reopenPeriod(closed.id, "Reaberto para teste")
    assert.equal(await isPeriodClosed(period.from, period.to), false)
  })

  await test("12. reabrir fechamento inexistente devolve 404", async () => {
    const r = await reopenPeriod("id-inexistente-xyz", "Motivo qualquer")
    assert.ok("error" in r)
    assert.equal(r.status, 404)
  })
}

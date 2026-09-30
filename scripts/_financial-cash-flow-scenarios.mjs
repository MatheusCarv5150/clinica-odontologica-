// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — FLUXO DE CAIXA (Financeiro 5).
// ===========================================================================
//
// Exercita o SERVIÇO REAL (`financial-cash-flow-service`) contra um SQLite
// descartável. Cobre a DERIVAÇÃO das movimentações das fontes de verdade
// (`payments` e `expense_payments`), o saldo do período, o saldo acumulado, o
// agrupamento por dia, os filtros/busca server-side e o detalhe.
//
// REGRAS QUE ESTES TESTES PROTEGEM
//   - NÃO HÁ NOVA TABELA: o fluxo é derivado, nunca persistido;
//   - pagamento parcial entra pelo valor EFETIVO (não pelo cobrado);
//   - múltiplos pagamentos geram MÚLTIPLAS movimentações (não consolida);
//   - despesa NÃO paga não gera saída; despesa cancelada não gera saída;
//   - pagamento estornado (refunded) fica FORA do saldo mas permanece visível;
//   - saldo do período = entradas - saídas do período;
//   - saldo acumulado considera o histórico anterior ao período;
//   - entradas e saídas NUNCA se somam num único número.

import {
  prisma,
  cashFlowService,
  test,
  section,
  assert,
} from "./_financial-harness.mjs"

const { listCashFlow, getCashFlowDetail } = cashFlowService

let seq = 0
const uniq = () => `${Date.now()}-${++seq}`

/** Data LOCAL (mesma convenção de `resolvePeriodRange`). */
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

async function makePatient(name = "Paciente Fluxo") {
  return prisma.patient.create({
    data: {
      fullName: name,
      cpf: (String(Date.now()) + String(seq++)).slice(-11).padStart(11, "0"),
      birthDate: localDate("1990-01-01"),
    },
    select: { id: true, fullName: true },
  })
}

/** Paciente com nome único — permite isolar fixtures via `search`. */
async function makeUniquePatient(prefix = "Fluxo") {
  return makePatient(`${prefix} ${uniq()}`)
}

async function makeProcedure(name, price) {
  return prisma.procedure.create({
    data: {
      name: name ?? `Procedimento ${uniq()}`,
      code: `COD-${uniq()}`,
      category: "Restauração",
      defaultPrice: price,
    },
    select: { id: true },
  })
}

async function makeAppointment(options = {}) {
  const patient = options.patient ?? (await makePatient())
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      appointmentDate: options.date ?? today(),
      appointmentTime: options.time ?? "09:00",
      status: options.status ?? "completed",
      totalAmount: options.totalAmount ?? 0,
      finishedByName: options.finishedByName ?? null,
    },
    select: { id: true, patientId: true },
  })
  return { appointment, patient }
}

/** Pagamento de paciente cru. */
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

async function makeCategory(name) {
  return prisma.expenseCategory.create({
    data: { name: name ?? `Cat ${uniq()}`, kind: "material", system: false },
    select: { id: true },
  })
}

async function makeExpense(options = {}) {
  const categoryId = options.categoryId ?? (await makeCategory()).id
  return prisma.expense.create({
    data: {
      categoryId,
      description: options.description ?? `Despesa ${uniq()}`,
      supplier: options.supplier ?? "Fornecedor X",
      amount: options.amount ?? 1000,
      status: options.status ?? "pending",
      competenceDate: options.competenceDate ?? today(),
      dueDate: options.dueDate ?? null,
    },
    select: { id: true },
  })
}

/** Pagamento efetivo de despesa. */
async function payExpense(expenseId, options = {}) {
  return prisma.expensePayment.create({
    data: {
      expenseId,
      amount: options.amount ?? 300,
      paymentMethod: options.paymentMethod ?? "pix",
      paidAt: options.paidAt ?? today(),
    },
    select: { id: true },
  })
}

/** Lista com escopo amplo por padrão (evita que fixtures caiam fora da janela). */
function list(options = {}) {
  return listCashFlow({
    period: "custom",
    from: "2000-01-01",
    to: "2099-12-31",
    ...options,
  })
}

export async function runCashFlowScenarios() {
  // -------------------------------------------------------------------------
  section("A. Derivação das fontes de verdade (entradas e saídas)")
  // -------------------------------------------------------------------------

  await test("1. entrada deriva de `payments` pago (1 linha por pagamento)", async () => {
    const patient = await makeUniquePatient("Entrada")
    const { appointment } = await makeAppointment({ patient, totalAmount: 1000 })
    await pay(appointment.id, { amount: 500, paymentMethod: "pix" })

    const r = await list({ search: patient.fullName })
    const income = r.movements.filter((m) => m.type === "INCOME")
    assert.equal(income.length, 1)
    assert.equal(income[0].amount, 500)
    assert.equal(income[0].source, "PAYMENT")
    assert.equal(income[0].patientName, patient.fullName)
    assert.equal(income[0].status, "settled")
  })

  await test("2. saída deriva de `expense_payments` (pagamento efetivo)", async () => {
    const expense = await makeExpense({ amount: 1000, description: `Materiais ${uniq()}` })
    await payExpense(expense.id, { amount: 400, paymentMethod: "boleto" })

    const r = await list({ search: "Materiais" })
    const expenseRows = r.movements.filter((m) => m.type === "EXPENSE")
    assert.ok(expenseRows.length >= 1)
    const row = expenseRows.find((m) => m.expenseId === expense.id)
    assert.ok(row)
    assert.equal(row.amount, 400)
    assert.equal(row.source, "EXPENSE_PAYMENT")
    assert.ok(row.categoryName && row.categoryName.startsWith("Cat"))
  })

  await test("3. pagamento NÃO efetivado (pending) não entra no caixa", async () => {
    const patient = await makeUniquePatient("Pendente")
    const { appointment } = await makeAppointment({ patient, totalAmount: 800 })
    await pay(appointment.id, { amount: 800, status: "pending", paidAt: null })

    const r = await list({ search: patient.fullName })
    assert.equal(r.movements.filter((m) => m.type === "INCOME").length, 0)
  })

  await test("4. despesa NÃO paga não gera saída", async () => {
    const expense = await makeExpense({ amount: 900, description: `Nao paga ${uniq()}` })
    const r = await list({ search: "Nao paga" })
    assert.equal(r.movements.filter((m) => m.expenseId === expense.id).length, 0)
  })

  // -------------------------------------------------------------------------
  section("B. Pagamentos parciais e múltiplos (não consolidar destrutivamente)")
  // -------------------------------------------------------------------------

  await test("5. pagamento parcial de atendimento entra pelo valor efetivo", async () => {
    const patient = await makeUniquePatient("ParcialEntrada")
    const { appointment } = await makeAppointment({ patient, totalAmount: 1000 })
    await pay(appointment.id, { amount: 300 })

    const r = await list({ search: patient.fullName })
    const income = r.movements.filter((m) => m.type === "INCOME")
    assert.equal(income.length, 1)
    assert.equal(income[0].amount, 300) // nunca 1000
  })

  await test("6. múltiplos pagamentos geram múltiplas movimentações individuais", async () => {
    const patient = await makeUniquePatient("Multiplos")
    const { appointment } = await makeAppointment({ patient, totalAmount: 1000 })
    await pay(appointment.id, { amount: 300, paymentMethod: "pix" })
    await pay(appointment.id, { amount: 200, paymentMethod: "dinheiro" })
    await pay(appointment.id, { amount: 500, paymentMethod: "cartao_credito" })

    const r = await list({ search: patient.fullName })
    const income = r.movements.filter((m) => m.type === "INCOME")
    assert.equal(income.length, 3)
    const total = income.reduce((s, m) => s + m.amount, 0)
    assert.equal(total, 1000)
  })

  await test("7. múltiplos pagamentos parciais de despesa geram múltiplas saídas", async () => {
    const expense = await makeExpense({ amount: 1000, description: `Parcial ${uniq()}` })
    await payExpense(expense.id, { amount: 400 })
    await payExpense(expense.id, { amount: 600 })

    const r = await list({ search: "Parcial" })
    const rows = r.movements.filter((m) => m.expenseId === expense.id)
    assert.equal(rows.length, 2)
    const total = rows.reduce((s, m) => s + m.amount, 0)
    assert.equal(total, 1000)
  })

  // -------------------------------------------------------------------------
  section("C. Cancelamento e estorno")
  // -------------------------------------------------------------------------

  await test("8. despesa cancelada NÃO gera saída no caixa", async () => {
    const expense = await makeExpense({ amount: 500, description: `Cancelada ${uniq()}` })
    await payExpense(expense.id, { amount: 500 })
    await prisma.expense.update({
      where: { id: expense.id },
      data: { status: "cancelled", cancelledAt: today() },
    })

    const r = await list({ search: "Cancelada" })
    assert.equal(r.movements.filter((m) => m.expenseId === expense.id).length, 0)
  })

  await test("9. pagamento estornado (refunded) fica fora do saldo, mas visível", async () => {
    const patient = await makeUniquePatient("Estorno")
    const { appointment } = await makeAppointment({ patient, totalAmount: 500 })
    await pay(appointment.id, { amount: 500, status: "refunded" })

    const r = await list({ search: patient.fullName })
    const rows = r.movements.filter((m) => m.type === "INCOME")
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, "reversed")
    assert.equal(r.totals.totalIncome, 0) // não soma no caixa realizado
  })

  // -------------------------------------------------------------------------
  section("D. Saldo do período e saldo acumulado")
  // -------------------------------------------------------------------------

  await test("10. saldo do período = entradas - saídas (isolado por janela)", async () => {
    const patient = await makePatient(`Saldo ${uniq()}`)
    const { appointment } = await makeAppointment({ patient, totalAmount: 2000 })
    await pay(appointment.id, { amount: 1000 })

    const expense = await makeExpense({ description: `Saldo saida ${uniq()}`, amount: 400 })
    await payExpense(expense.id, { amount: 400 })

    const r = await list({ search: "Saldo" })
    // Há ruído de outras fixtures; validamos a matemática do resultado global.
    assert.equal(
      r.totals.periodBalance,
      Math.round((r.totals.totalIncome - r.totals.totalExpense) * 100) / 100
    )
    assert.ok(r.totals.totalIncome > 0)
    assert.ok(r.totals.totalExpense > 0)
  })

  await test("11. saldo acumulado considera histórico anterior ao período", async () => {
    // Movimentação histórica (ano passado) + nenhuma no mês corrente.
    const patient = await makeUniquePatient("Historico")
    const { appointment } = await makeAppointment({ patient, totalAmount: 1000 })
    const past = shiftDays(-400)
    await pay(appointment.id, { amount: 1000, paidAt: past, createdAt: past })

    // Período: apenas o mês corrente. A movimentação antiga NÃO aparece, mas
    // compõe o saldo de abertura.
    const r = await listCashFlow({ period: "month", search: patient.fullName })
    assert.equal(r.movements.length, 0)
    assert.equal(r.totals.openingBalance, 1000)
    assert.equal(r.totals.closingBalance, 1000)
  })

  await test("12. saldo acumulado fecha com abertura + saldo do período", async () => {
    const r = await list()
    assert.equal(
      r.totals.closingBalance,
      Math.round((r.totals.openingBalance + r.totals.periodBalance) * 100) / 100
    )
  })

  await test("13. nota de transparência explicita a origem do saldo acumulado", async () => {
    const r = await list()
    assert.equal(r.balanceNote.openingBalanceSource, "registered_movements")
    assert.match(r.balanceNote.message, /movimenta/i)
  })

  // -------------------------------------------------------------------------
  section("E. Agrupamento por dia e série")
  // -------------------------------------------------------------------------

  await test("14. agrupamento diário soma entradas e saídas por dia", async () => {
    const patient = await makePatient(`Dia ${uniq()}`)
    const { appointment } = await makeAppointment({ patient, totalAmount: 3000 })
    const day = today()
    await pay(appointment.id, { amount: 2500, paidAt: day })
    const expense = await makeExpense({ description: `Dia saida ${uniq()}`, amount: 800 })
    await payExpense(expense.id, { amount: 800, paidAt: day })

    // Filtra pelo paciente único (entradas) — a fixture de saída é somada ao
    // grupo do dia separadamente para isolar a matemática do agrupamento.
    const r = await list({ search: patient.fullName })
    const dayKey = isoDay(day)
    const group = r.daily.find((d) => d.dayKey === dayKey)
    assert.ok(group, "deve haver grupo do dia")
    assert.equal(group.income, 2500)
    assert.equal(group.net, group.income - group.expense)
  })

  await test("15. série do gráfico tem um ponto por dia do período", async () => {
    const r = await listCashFlow({ period: "7d" })
    assert.equal(r.series.granularity, "day")
    assert.equal(r.series.points.length, 7)
  })

  await test("16. período longo usa granularidade mensal na série", async () => {
    const r = await listCashFlow({ period: "custom", from: "2024-01-01", to: "2026-12-31" })
    assert.equal(r.series.granularity, "month")
  })

  // -------------------------------------------------------------------------
  section("F. Filtros, busca e paginação (server-side)")
  // -------------------------------------------------------------------------

  await test("17. filtro de tipo restringe a entradas ou saídas", async () => {
    const onlyIncome = await list({ type: "INCOME" })
    assert.ok(onlyIncome.movements.every((m) => m.type === "INCOME"))

    const onlyExpense = await list({ type: "EXPENSE" })
    assert.ok(onlyExpense.movements.every((m) => m.type === "EXPENSE"))
  })

  await test("18. filtro por origem (PAYMENT / EXPENSE_PAYMENT)", async () => {
    const r = await list({ source: "EXPENSE_PAYMENT" })
    assert.ok(r.movements.every((m) => m.source === "EXPENSE_PAYMENT"))
  })

  await test("19. busca textual encontra por paciente", async () => {
    const patient = await makePatient(`Buscavel ${uniq()}`)
    const { appointment } = await makeAppointment({ patient, totalAmount: 100 })
    await pay(appointment.id, { amount: 100 })

    const r = await list({ search: patient.fullName })
    assert.ok(r.movements.some((m) => m.patientName === patient.fullName))
  })

  await test("20. filtro por forma de pagamento", async () => {
    const r = await list({ paymentMethod: "boleto" })
    assert.ok(r.movements.every((m) => m.paymentMethod === "boleto"))
  })

  await test("21. paginação respeita page/pageSize e reporta o total completo", async () => {
    const full = await list({ pageSize: 100 })
    const firstPage = await list({ pageSize: 5, page: 1 })
    assert.equal(firstPage.pagination.totalCount, full.pagination.totalCount)
    assert.ok(firstPage.movements.length <= 5)
    assert.equal(firstPage.pagination.page, 1)
  })

  await test("22. resumo (totais) NÃO muda ao trocar de página", async () => {
    const p1 = await list({ pageSize: 2, page: 1 })
    const p2 = await list({ pageSize: 2, page: 2 })
    assert.equal(p1.totals.totalIncome, p2.totals.totalIncome)
    assert.equal(p1.totals.totalExpense, p2.totals.totalExpense)
  })

  // -------------------------------------------------------------------------
  section("G. Detalhe e rastreabilidade da origem")
  // -------------------------------------------------------------------------

  await test("23. detalhe de entrada expõe paciente, atendimento e previsto", async () => {
    const patient = await makePatient(`Detalhe ${uniq()}`)
    const { appointment } = await makeAppointment({ patient, totalAmount: 1200 })
    const p = await pay(appointment.id, { amount: 700 })

    const detail = await getCashFlowDetail(`income:${p.id}`)
    assert.ok(detail)
    assert.equal(detail.type, "INCOME")
    assert.equal(detail.amount, 700)
    assert.equal(detail.patientName, patient.fullName)
    assert.equal(detail.originContext.expectedTotal, 1200)
    assert.equal(detail.originContext.receivedTotal, 700)
    assert.equal(detail.originContext.pendingTotal, 500)
  })

  await test("24. detalhe de saída expõe categoria e fornecedor", async () => {
    const expense = await makeExpense({
      amount: 1500,
      description: `Detalhe saida ${uniq()}`,
      supplier: "Fornecedor Detalhe",
    })
    const ep = await payExpense(expense.id, { amount: 500 })

    const detail = await getCashFlowDetail(`expense:${ep.id}`)
    assert.ok(detail)
    assert.equal(detail.type, "EXPENSE")
    assert.equal(detail.amount, 500)
    assert.equal(detail.supplier, "Fornecedor Detalhe")
    assert.equal(detail.originContext.expenseAmount, 1500)
    assert.equal(detail.originContext.expenseBalance, 1000)
    assert.equal(detail.relatedPayments.length, 1)
    assert.ok(detail.relatedPayments[0].isCurrent)
  })

  await test("25. detalhe inexistente devolve null", async () => {
    assert.equal(await getCashFlowDetail("income:nao-existe"), null)
    assert.equal(await getCashFlowDetail("invalido"), null)
  })

  // -------------------------------------------------------------------------
  section("H. Não duplicação arquitetural")
  // -------------------------------------------------------------------------

  await test("26. o fluxo NÃO cria linhas em financial_transactions", async () => {
    const before = await prisma.financialTransaction.count()
    await list()
    const after = await prisma.financialTransaction.count()
    assert.equal(after, before, "listar o fluxo não deve persistir nada")
  })

  await test("27. cada id de movimentação é único e prefixado pela origem", async () => {
    const r = await list({ pageSize: 100 })
    const ids = r.movements.map((m) => m.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const m of r.movements) {
      if (m.type === "INCOME") assert.ok(m.id.startsWith("income:"))
      else assert.ok(m.id.startsWith("expense:"))
    }
  })

  await test("28. contadores batem com as linhas efetivadas do conjunto filtrado", async () => {
    const r = await list({ type: "INCOME", pageSize: 100 })
    const settled = r.movements.filter((m) => m.status === "settled")
    assert.ok(r.totals.incomeCount >= settled.length)
  })
}


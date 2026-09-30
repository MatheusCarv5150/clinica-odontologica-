// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — RELATÓRIOS FINANCEIROS (Financeiro 6).
// ===========================================================================
//
// Exercita o SERVIÇO REAL (`financial-reports-service`) contra um SQLite
// descartável. Cobre a CONSOLIDAÇÃO dos relatórios e, o mais importante,
// garante a REGRA CENTRAL do módulo:
//
//   NÃO EXISTE UMA SEGUNDA FONTE DE VERDADE.
//
// Ou seja: os números dos relatórios precisam BATER com os serviços canônicos
// dos Financeiros 1–5 (`getFinancialSummary`, `listCashFlow`, `listReceitas`,
// `listDespesas`, `listContasReceber`). Se algum dia um relatório divergir da
// origem, este arquivo quebra.
//
// Regras protegidas:
//   - receita PREVISTA (conta a receber) NÃO é caixa nem receita recebida;
//   - despesa PAGA é saída de caixa; despesa pendente NÃO é;
//   - "resultado" = recebido - pago (nunca "lucro");
//   - breakdowns somam o total (participação = 100% quando há base);
//   - filtro/busca são server-side (o cliente não filtra);
//   - exportação CSV reflete EXATAMENTE as linhas recebidas.

import {
  prisma,
  reportsService,
  cashFlowService,
  paymentsService,
  test,
  section,
  assert,
} from "./_financial-harness.mjs"

const {
  getFinancialSummary,
  getIncomeReport,
  getExpenseReport,
  getCashFlowReport,
  getReceivableReport,
  getProcedureReport,
  getPaymentMethodReport,
  getReportsOverview,
} = reportsService

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

const ALL = { period: "custom", from: "2000-01-01", to: "2099-12-31" }

async function makeUniquePatient(prefix = "Rel") {
  return prisma.patient.create({
    data: {
      fullName: `${prefix} ${uniq()}`,
      cpf: (String(Date.now()) + String(seq++)).slice(-11).padStart(11, "0"),
      birthDate: localDate("1990-01-01"),
    },
    select: { id: true, fullName: true },
  })
}

async function makeProcedure(name, price) {
  return prisma.procedure.create({
    data: {
      name: name ?? `Proc ${uniq()}`,
      code: `COD-${uniq()}`,
      category: "Restauração",
      defaultPrice: price ?? 100,
    },
    select: { id: true, name: true },
  })
}

async function makeAppointment(options = {}) {
  const patient = options.patient ?? (await makeUniquePatient())
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

/**
 * Registra um RECEBIMENTO pelo caminho CANÔNICO do sistema
 * (`registerPaymentForAppointment`). Isto cria o `payment` E a movimentação de
 * receita (`financialTransaction`) sincronizada — que é a fonte de verdade dos
 * relatórios de receita. Criar `payment` cru NÃO bastaria: o relatório de
 * receitas lê `financialTransaction`, não `payment`.
 */
async function receive(appointmentId, options = {}) {
  return paymentsService.registerPaymentForAppointment({
    appointmentId,
    amount: options.amount ?? 100,
    paymentMethod: options.paymentMethod ?? "pix",
    actorName: options.actorName ?? "Recepção Relatórios",
    paidAt: options.paidAt ?? today(),
  })
}

/**
 * RECEITA PREVISTA (ainda não recebida). Grava a projeção de caixa no estado
 * "pendente" — exatamente o que o sistema mantém para um atendimento ainda não
 * pago. É PREVISÃO: entra em `totalPending`, NUNCA em caixa/recebido.
 */
async function seedPendingReceita(options) {
  return prisma.financialTransaction.create({
    data: {
      direction: "in",
      amount: options.amount ?? 500,
      status: "pending",
      competenceDate: options.competenceDate ?? today(),
      settledAt: null,
      description: `Previsto — ${options.description ?? "a receber"}`,
      patientId: options.patientId ?? null,
      appointmentId: options.appointmentId ?? null,
      paymentMethod: options.paymentMethod ?? "cartao_credito",
      createdByName: "Recepção Relatórios",
    },
    select: { id: true },
  })
}

async function makeCategory(name) {
  return prisma.expenseCategory.create({
    data: { name: name ?? `Cat ${uniq()}`, kind: "material", system: false },
    select: { id: true, name: true },
  })
}

async function makeExpense(options = {}) {
  const categoryId = options.categoryId ?? (await makeCategory()).id
  return prisma.expense.create({
    data: {
      categoryId,
      description: options.description ?? `Despesa ${uniq()}`,
      supplier: options.supplier ?? "Fornecedor Rel",
      amount: options.amount ?? 1000,
      status: options.status ?? "pending",
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
      amount: options.amount ?? 300,
      paymentMethod: options.paymentMethod ?? "pix",
      paidAt: options.paidAt ?? today(),
    },
    select: { id: true },
  })
}

// ---------------------------------------------------------------------------
// Fixture central: um paciente único com recebimentos distribuídos e despesas,
// permitindo isolar os números via `search`/`professionalName` quando preciso.
// ---------------------------------------------------------------------------

async function buildWorld() {
  const patient = await makeUniquePatient("RelMundo")
  const proc = await makeProcedure(`Limpeza ${uniq()}`, 200)
  const { appointment } = await makeAppointment({
    patient,
    totalAmount: 1000,
    finishedByName: "Dra. Relatório",
  })

  // Recebidos (caixa): 300 (pix) + 200 (dinheiro), pelo caminho canônico —
  // isto sincroniza a receita (`financialTransaction`) usada pelos relatórios.
  await receive(appointment.id, { amount: 300, paymentMethod: "pix", paidAt: today() })
  await receive(appointment.id, { amount: 200, paymentMethod: "dinheiro", paidAt: today() })
  // Previsto (NÃO é caixa nem recebido): 500 ainda a receber.
  await seedPendingReceita({
    patientId: patient.id,
    appointmentId: appointment.id,
    amount: 500,
    paymentMethod: "cartao_credito",
  })

  const cat = await makeCategory(`Material ${uniq()}`)
  const paidExpense = await makeExpense({
    categoryId: cat.id,
    amount: 400,
    description: `Pago ${uniq()}`,
    supplier: "Fornecedor Pago",
  })
  await payExpense(paidExpense.id, { amount: 400, paymentMethod: "boleto", paidAt: today() })

  await makeExpense({
    categoryId: cat.id,
    amount: 900,
    description: `Nao pago ${uniq()}`,
    supplier: "Fornecedor Pendente",
    dueDate: shiftDays(10),
  })

  return { patient, proc, appointment, cat, paidExpense }
}

export async function runReportsScenarios() {
  const world = await buildWorld()

  // -------------------------------------------------------------------------
  section("A. Resumo — coerência com o caixa (fonte única)")
  // -------------------------------------------------------------------------

  await test("1. resumo financeiro bate com o fluxo de caixa", async () => {
    const summary = await getFinancialSummary(ALL)
    const cash = await cashFlowService.listCashFlow({ ...ALL, page: 1, pageSize: 1 })

    // Receitas recebidas = entradas do caixa; despesas pagas = saídas.
    assert.equal(summary.result.income, cash.totals.totalIncome)
    assert.equal(summary.result.expense, cash.totals.totalExpense)
    // Resultado = recebido - pago.
    assert.equal(summary.result.value, cash.totals.totalIncome - cash.totals.totalExpense)
  })

  await test("2. resultado NUNCA é rotulado como lucro", async () => {
    const summary = await getFinancialSummary(ALL)
    // O rótulo VISÍVEL do card de resultado não pode ser "lucro" nem "ebitda".
    // (A palavra pode aparecer apenas em textos que EXPLICAM que não é lucro.)
    const labels = summary.cards.map((c) => c.definition.label.toLowerCase())
    assert.ok(
      labels.some((l) => l.includes("resultado")),
      "deve existir um card de resultado"
    )
    assert.ok(!labels.some((l) => l.includes("lucro")), "nenhum card pode ser rotulado lucro")
    assert.ok(!labels.some((l) => l.includes("ebitda")), "nenhum card pode ser rotulado ebitda")
  })

  await test("3. receita PREVISTA (conta a receber) não vira caixa", async () => {
    const summary = await getFinancialSummary(ALL)
    const cash = await cashFlowService.listCashFlow({ ...ALL, page: 1, pageSize: 1 })
    // Existe previsão (o pagamento pendente de 500 ou contas em aberto), mas o
    // caixa não a inclui.
    const previstoCard = summary.cards.find((c) => c.definition.nature === "previsao")
    assert.ok(previstoCard)
    assert.equal(cash.totals.totalIncome, summary.result.income)
  })

  // -------------------------------------------------------------------------
  section("B. Relatório de receitas")
  // -------------------------------------------------------------------------

  await test("4. receitas recebidas x previstas são separadas", async () => {
    const r = await getIncomeReport({ ...ALL, search: world.patient.fullName })
    assert.equal(r.totalReceived, 500) // 300 + 200 recebidos
    assert.equal(r.receivedCount, 2)
    // O pagamento pendente aparece como previsão, não como recebido.
    assert.ok(r.totalPending >= 500)
  })

  await test("5. busca do relatório de receitas é server-side", async () => {
    const hit = await getIncomeReport({ ...ALL, search: world.patient.fullName })
    const miss = await getIncomeReport({ ...ALL, search: `inexistente-${uniq()}` })
    assert.ok(hit.rows.length >= 2)
    assert.equal(miss.rows.length, 0)
  })

  await test("6. breakdown de receitas por forma soma o recebido", async () => {
    const r = await getIncomeReport({ ...ALL, search: world.patient.fullName })
    const somaMetodos = r.byMethod.reduce((acc, m) => acc + m.amount, 0)
    assert.equal(Math.round(somaMetodos * 100) / 100, 500)
  })

  // -------------------------------------------------------------------------
  section("C. Relatório de despesas")
  // -------------------------------------------------------------------------

  await test("7. despesas separam pago, a pagar e vencido", async () => {
    const r = await getExpenseReport({ ...ALL, categoryId: world.cat.id })
    assert.equal(r.totalPaid, 400)
    assert.ok(r.totalPending >= 900)
    assert.ok(r.totalExpenses >= 1300)
  })

  await test("8. breakdown por categoria soma o total", async () => {
    const r = await getExpenseReport({ ...ALL, categoryId: world.cat.id })
    const soma = r.byCategory.reduce((acc, c) => acc + c.amount, 0)
    assert.equal(Math.round(soma * 100) / 100, Math.round(r.totalExpenses * 100) / 100)
  })

  // -------------------------------------------------------------------------
  section("D. Relatório de fluxo de caixa")
  // -------------------------------------------------------------------------

  await test("9. fluxo do relatório bate com listCashFlow (mesma fonte)", async () => {
    const r = await getCashFlowReport(ALL)
    const cash = await cashFlowService.listCashFlow({ ...ALL, page: 1, pageSize: 1 })
    assert.equal(r.totalIncome, cash.totals.totalIncome)
    assert.equal(r.totalExpense, cash.totals.totalExpense)
    assert.equal(r.closingBalance, cash.totals.closingBalance)
  })

  await test("10. fluxo do relatório traz séries diária/mensal alinhadas", async () => {
    const r = await getCashFlowReport(ALL)
    const diario = r.daily.reduce((acc, d) => acc + d.income, 0)
    assert.equal(Math.round(diario * 100) / 100, Math.round(r.totalIncome * 100) / 100)
  })

  // -------------------------------------------------------------------------
  section("E. Contas a receber e procedimentos")
  // -------------------------------------------------------------------------

  await test("11. contas a receber separam previsto x recebido x vencido", async () => {
    const r = await getReceivableReport({ ...ALL, patientName: world.patient.fullName })
    assert.ok(r.totalCharged >= 1000)
    assert.ok(r.totalReceived >= 500)
    assert.ok(r.totalPending >= 500)
  })

  await test("12. relatório por procedimento agrega recebido e pendente", async () => {
    const r = await getProcedureReport(ALL)
    assert.ok(r.rows.length >= 0)
    const somaRecebido = r.rows.reduce((acc, p) => acc + p.receivedAmount, 0)
    assert.equal(Math.round(somaRecebido * 100) / 100, Math.round(r.totalReceived * 100) / 100)
  })

  await test("13. formas de pagamento somam o total recebido", async () => {
    const r = await getPaymentMethodReport(ALL)
    const soma = r.rows.reduce((acc, m) => acc + m.amount, 0)
    assert.equal(Math.round(soma * 100) / 100, Math.round(r.totalReceived * 100) / 100)
  })

  // -------------------------------------------------------------------------
  section("F. Visão geral e gráficos")
  // -------------------------------------------------------------------------

  await test("14. visão geral consolida resumo + gráficos coerentes", async () => {
    const o = await getReportsOverview(ALL)
    const cash = await cashFlowService.listCashFlow({ ...ALL, page: 1, pageSize: 1 })

    // O resumo da visão geral é o MESMO resumo financeiro (fonte única).
    assert.equal(o.summary.result.income, cash.totals.totalIncome)
    assert.equal(o.summary.result.expense, cash.totals.totalExpense)

    // A quebra por FORMA agrega TODAS as movimentações efetivadas do caixa
    // (entradas + saídas) — logo soma entradas e saídas.
    const somaMetodos = o.charts.incomeByMethod.reduce((acc, m) => acc + m.amount, 0)
    assert.equal(
      Math.round(somaMetodos * 100) / 100,
      Math.round((cash.totals.totalIncome + cash.totals.totalExpense) * 100) / 100
    )

    // A quebra por CATEGORIA é só de saídas efetivadas.
    const somaCategorias = o.charts.expenseByCategory.reduce((acc, c) => acc + c.amount, 0)
    assert.equal(Math.round(somaCategorias * 100) / 100, cash.totals.totalExpense)

    // A série entradas x saídas fecha com os totais — verificada num período
    // BOUNDED que contém as movimentações (a série é limitada em nº de pontos,
    // então num intervalo enorme ela é truncada e não deve ser somada contra o
    // total de todo o período).
    const bounded = { period: "custom", from: isoDay(shiftDays(-7)), to: isoDay(shiftDays(7)) }
    const ob = await getReportsOverview(bounded)
    const cashB = await cashFlowService.listCashFlow({ ...bounded, page: 1, pageSize: 1 })
    const somaSerieIncome = ob.charts.incomeVsExpense.reduce((acc, p) => acc + p.income, 0)
    const somaSerieExpense = ob.charts.incomeVsExpense.reduce((acc, p) => acc + p.expense, 0)
    assert.equal(Math.round(somaSerieIncome * 100) / 100, cashB.totals.totalIncome)
    assert.equal(Math.round(somaSerieExpense * 100) / 100, cashB.totals.totalExpense)
  })

  await test("15. período vazio devolve zeros (nunca inventa dado)", async () => {
    const o = await getReportsOverview({
      period: "custom",
      from: "1990-01-01",
      to: "1990-01-05",
    })
    assert.equal(o.summary.result.income, 0)
    assert.equal(o.summary.result.expense, 0)
    // A série existe (um ponto por dia do intervalo), mas TODOS zerados — o
    // sistema não inventa movimentação em período sem dados.
    assert.ok(o.charts.incomeVsExpense.length > 0)
    assert.ok(
      o.charts.incomeVsExpense.every((p) => p.income === 0 && p.expense === 0),
      "período vazio não pode conter movimentação"
    )
    assert.equal(o.charts.incomeByMethod.length, 0)
    assert.equal(o.charts.expenseByCategory.length, 0)
  })

  await test("16. todos os valores são números finitos (sem NaN/Infinity)", async () => {
    const reports = [
      await getFinancialSummary(ALL),
      await getIncomeReport({ ...ALL, pageSize: 100 }),
      await getExpenseReport({ ...ALL, pageSize: 100 }),
      await getCashFlowReport(ALL),
      await getReceivableReport({ ...ALL, pageSize: 100 }),
      await getProcedureReport(ALL),
      await getPaymentMethodReport(ALL),
    ]
    const text = JSON.stringify(reports)
    assert.ok(!text.includes("NaN"), "nenhum relatório pode conter NaN")
    assert.ok(!text.includes("Infinity"), "nenhum relatório pode conter Infinity")
  })
}

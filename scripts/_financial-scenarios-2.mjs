// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — FINANCEIRO (Financeiro 1) — parte 2.
// ===========================================================================
// Dashboard, validação de entrada, convênios e verificação de NÃO duplicação.

import {
  prisma,
  service,
  expenseService,
  dashboardService,
  schemas,
  test,
  section,
  assert,
} from "./_financial-harness.mjs"

let seq = 0
const uniq = () => `${Date.now()}-${++seq}`

/**
 * Data LOCAL a partir de "YYYY-MM-DD".
 *
 * Importante: `new Date("2026-09-29")` é interpretado como UTC meia-noite, o
 * que no fuso do Brasil (UTC-3) vira 21h do dia ANTERIOR. Como o serviço de
 * dashboard resolve o período em horário LOCAL, os fixtures precisam usar a
 * mesma convenção para que o atendimento caia dentro da janela esperada.
 */
function localDate(iso) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

async function makePatient(name = "Paciente Financeiro") {
  return prisma.patient.create({
    data: {
      fullName: name,
      cpf: (String(Date.now()) + String(seq++)).slice(-11).padStart(11, "0"),
      birthDate: localDate("1990-01-01"),
    },
    select: { id: true, fullName: true },
  })
}

async function makeProcedure(price = 100) {
  return prisma.procedure.create({
    data: {
      name: `Procedimento ${uniq()}`,
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
      appointmentDate: options.date ?? localDate("2026-09-10"),
      appointmentTime: "09:00",
      status: options.status ?? "completed",
      totalAmount: options.totalAmount === undefined ? 200 : options.totalAmount,
    },
    select: { id: true, patientId: true },
  })
  return { appointment, patient }
}

async function makePayment(appointmentId, options = {}) {
  return prisma.payment.create({
    data: {
      appointmentId,
      amount: options.amount ?? 100,
      paymentMethod: options.paymentMethod ?? "pix",
      status: options.status ?? "paid",
      paidAt: options.paidAt ?? localDate("2026-09-10"),
    },
    select: { id: true },
  })
}

export async function runIntegrationScenariosPart2() {
  const { isFinancialError } = service

  // -------------------------------------------------------------------------
  section("Dashboard — projeção fiel dos dados reais")
  // -------------------------------------------------------------------------

  await test("dashboard do período reflete recebido e pago reais", async () => {
    const range = { preset: "custom", from: "2026-09-25", to: "2026-09-25" }
    const baseline = await dashboardService.getFinancialDashboard(range)

    const { appointment } = await makeAppointment({
      totalAmount: 450,
      date: localDate("2026-09-25"),
    })
    await makePayment(appointment.id, {
      amount: 450,
      paidAt: localDate("2026-09-25"),
    })
    await service.syncIncomeFromPayments()

    const after = await dashboardService.getFinancialDashboard(range)

    assert.equal(
      Math.round(after.cash.received * 100),
      Math.round(baseline.cash.received * 100) + 45000,
      "recebido cresce exatamente pelo valor pago"
    )
  })

  await test("período sem movimentação devolve zeros e listas vazias", async () => {
    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "1990-01-01",
      to: "1990-01-31",
    })

    assert.equal(dashboard.cash.received, 0)
    assert.equal(dashboard.cash.paid, 0)
    assert.equal(dashboard.cash.net, 0)
    assert.equal(dashboard.income.total, 0)
    assert.equal(dashboard.expense.total, 0)
    assert.equal(dashboard.recentTransactions.length, 0)
    assert.equal(dashboard.expensesByCategory.length, 0)
    assert.equal(dashboard.incomeByMethod.length, 0)
    assert.equal(dashboard.meta.transactionsConsidered, 0)
  })

  await test("canceladas e estornadas NÃO entram nos totais do dashboard", async () => {
    const categories = await expenseService.listExpenseCategories()
    const created = await expenseService.createExpense(
      {
        categoryId: categories[0].id,
        description: "Despesa cancelada no dashboard",
        amount: 9999,
        competenceDate: "1995-06-15",
        markAsPaid: true,
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(created))
    await expenseService.cancelExpense(created.id, null, { userId: null, name: "Ana" })

    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "1995-06-01",
      to: "1995-06-30",
    })

    assert.equal(dashboard.cash.paid, 0, "cancelada não infla despesas")
    assert.equal(dashboard.expense.total, 0)
  })

  await test("contas a receber são PREVISÃO, não receita", async () => {
    const patient = await makePatient("Paciente Devedor")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 700,
      status: "completed",
      date: localDate("2026-09-26"),
    })
    // Nenhum pagamento: tudo pendente.

    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "2026-09-26",
      to: "2026-09-26",
    })

    assert.ok(
      dashboard.accountsReceivable.total >= 700,
      "pendente aparece em contas a receber"
    )

    const txs = await prisma.financialTransaction.count({
      where: { appointmentId: appointment.id },
    })
    assert.equal(txs, 0, "sem pagamento, sem movimentação de receita")
  })

  await test("atendimento cancelado não entra em alertas de recebimento", async () => {
    const { appointment } = await makeAppointment({
      totalAmount: 8888,
      status: "cancelled",
      date: localDate("2026-09-27"),
    })

    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "2026-09-27",
      to: "2026-09-27",
    })

    const found = dashboard.integrity.overpaidAppointments.some(
      (i) => i.appointmentId === appointment.id
    )
    assert.equal(found, false, "cancelado não aparece em alertas")
  })

  await test("recebimento excedente é exposto como alerta de integridade", async () => {
    const patient = await makePatient("Paciente Excedente")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 400,
      date: localDate("2026-09-28"),
    })
    await makePayment(appointment.id, {
      amount: 400,
      paidAt: localDate("2026-09-28"),
    })
    await makePayment(appointment.id, {
      amount: 400,
      paidAt: localDate("2026-09-28"),
    })
    await service.syncIncomeFromPayments()

    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "2026-09-28",
      to: "2026-09-28",
    })

    const alert = dashboard.integrity.overpaidAppointments.find(
      (i) => i.appointmentId === appointment.id
    )
    assert.ok(alert, "excedente deve ser sinalizado")
    assert.equal(alert.overpaid, 400)
    assert.equal(alert.received, 800)
    assert.equal(alert.patientName, patient.fullName)
  })

  await test("divergência entre total declarado e procedimentos é exposta", async () => {
    const patient = await makePatient("Paciente Divergente")
    const procedure = await makeProcedure(100)

    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        appointmentDate: localDate("2026-09-29"),
        appointmentTime: "14:00",
        status: "completed",
        totalAmount: 500, // declarado
      },
    })
    await prisma.appointmentProcedure.create({
      data: {
        appointmentId: appointment.id,
        procedureId: procedure.id,
        procedureNameSnapshot: "Procedimento X",
        unitPrice: 150,
        quantity: 2,
        totalPrice: 300, // soma real: 300 ≠ 500
      },
    })

    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "2026-09-29",
      to: "2026-09-29",
    })

    const alert = dashboard.integrity.declaredVsProceduresMismatch.find(
      (i) => i.appointmentId === appointment.id
    )
    assert.ok(alert, "divergência deve ser sinalizada")
    assert.equal(alert.declaredTotal, 500)
    assert.equal(alert.proceduresTotal, 300)
    assert.equal(alert.diff, 200)
  })

  await test("categorias do dashboard só incluem despesas com valor REAL", async () => {
    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "2026-09-20",
      to: "2026-09-20",
    })

    assert.equal(dashboard.expensesByCategory.length, 0)
    assert.equal(dashboard.cash.paid, 0)
  })

  await test("o filtro de período restringe contas a receber e alertas", async () => {
    // Atendimento com divergência FORA da janela consultada.
    const patient = await makePatient("Paciente Fora da Janela")
    const procedure = await makeProcedure(50)
    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id,
        appointmentDate: localDate("2026-01-15"),
        appointmentTime: "10:00",
        status: "completed",
        totalAmount: 999,
      },
    })
    await prisma.appointmentProcedure.create({
      data: {
        appointmentId: appointment.id,
        procedureId: procedure.id,
        procedureNameSnapshot: "Fora da janela",
        unitPrice: 50,
        quantity: 1,
        totalPrice: 50,
      },
    })

    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "2026-02-01",
      to: "2026-02-28",
    })

    const leaked = dashboard.integrity.declaredVsProceduresMismatch.some(
      (i) => i.appointmentId === appointment.id
    )
    assert.equal(leaked, false, "atendimento fora da janela não vaza para o período")
  })

  await test("série temporal só traz dias dentro do período", async () => {
    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "2026-09-01",
      to: "2026-09-05",
    })

    assert.equal(dashboard.series.granularity, "day")
    assert.equal(dashboard.series.points.length, 5)
    assert.equal(dashboard.series.points[0].key, "2026-09-01")
    assert.equal(dashboard.series.points[4].key, "2026-09-05")
  })

  await test("paciente das movimentações recentes vem resolvido do servidor", async () => {
    const patient = await makePatient("Paciente Recente")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 210,
      date: localDate("2026-09-30"),
    })
    await makePayment(appointment.id, {
      amount: 210,
      paidAt: localDate("2026-09-30"),
    })
    await service.syncIncomeFromPayments()

    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "2026-09-30",
      to: "2026-09-30",
    })

    const item = dashboard.recentTransactions.find(
      (t) => t.appointmentId === appointment.id
    )
    assert.ok(item, "movimentação deve aparecer")
    assert.equal(item.patientName, patient.fullName)
    assert.equal(item.patientId, patient.id)
    assert.equal(item.source, "payment")
  })

  await test("despesa aparece no dashboard como saída, marcada como despesa", async () => {
    const categories = await expenseService.listExpenseCategories()
    const created = await expenseService.createExpense(
      {
        categoryId: categories[0].id,
        description: "Despesa visível no fluxo",
        amount: 320,
        competenceDate: "2026-10-02",
        markAsPaid: true,
        paymentMethod: "dinheiro",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(created))

    const dashboard = await dashboardService.getFinancialDashboard({
      preset: "custom",
      from: "2026-10-02",
      to: "2026-10-02",
    })

    assert.equal(dashboard.cash.paid, 320)
    assert.equal(dashboard.expense.total, 320)

    const item = dashboard.recentTransactions.find((t) => t.id !== undefined &&
      t.description === "Despesa visível no fluxo")
    assert.ok(item, "despesa deve aparecer nas movimentações recentes")
    assert.equal(item.direction, "out")
    assert.equal(item.source, "expense")
    assert.ok(dashboard.expensesByCategory.length >= 1, "categoria real aparece")
  })

  // -------------------------------------------------------------------------
  section("Validação de entrada (schemas)")
  // -------------------------------------------------------------------------

  await test("createExpenseSchema rejeita valor não positivo", () => {
    const result = schemas.createExpenseSchema.safeParse({
      categoryId: "c1",
      description: "Compra",
      amount: 0,
      competenceDate: "2026-09-01",
    })
    assert.equal(result.success, false)
  })

  await test("createExpenseSchema rejeita data em formato inválido", () => {
    const result = schemas.createExpenseSchema.safeParse({
      categoryId: "c1",
      description: "Compra",
      amount: 100,
      competenceDate: "01/09/2026",
    })
    assert.equal(result.success, false)
  })

  await test("createExpenseSchema aceita payload válido com ator textual", () => {
    const result = schemas.createExpenseSchema.safeParse({
      categoryId: "c1",
      description: "Compra de material",
      amount: 250.5,
      competenceDate: "2026-09-01",
      actorName: "Dra. Ana",
    })
    assert.equal(result.success, true)
    assert.equal(result.data.actorName, "Dra. Ana")
  })

  await test("parsePeriodFromSearchParams rejeita preset desconhecido", () => {
    const p = schemas.parsePeriodFromSearchParams(new URLSearchParams("period=hack"))
    assert.equal(p.preset, "month", "cai para o padrão seguro")
  })

  await test("parsePeriodFromSearchParams exige datas válidas para custom", () => {
    const p = schemas.parsePeriodFromSearchParams(
      new URLSearchParams("period=custom&from=abc&to=def")
    )
    assert.equal(p.preset, "month", "custom inválido não passa")
    assert.equal(p.from, undefined)
  })

  await test("insurancePlanSchema limita percentual de cobertura", () => {
    const ok = schemas.insurancePlanSchema.safeParse({
      name: "Convênio X",
      kind: "convenio",
      coveragePercent: 70,
    })
    assert.equal(ok.success, true)

    const bad = schemas.insurancePlanSchema.safeParse({
      name: "Convênio Y",
      kind: "convenio",
      coveragePercent: 150,
    })
    assert.equal(bad.success, false)
  })

  await test("expenseCategorySchema rejeita tipo desconhecido", () => {
    const result = schemas.expenseCategorySchema.safeParse({
      name: "Nova categoria",
      kind: "inexistente",
    })
    assert.equal(result.success, false)
  })

  // -------------------------------------------------------------------------
  section("Convênios — dado de referência, não altera valores")
  // -------------------------------------------------------------------------

  await test("convênio é criado e não altera o valor do atendimento", async () => {
    const plan = await expenseService.createInsurancePlan({
      name: `Convênio ${uniq()}`,
      kind: "convenio",
      coveragePercent: 60,
    })
    assert.ok(!isFinancialError(plan))

    const { appointment } = await makeAppointment({ totalAmount: 320 })
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { insurancePlanId: plan.id },
    })

    const after = await prisma.appointment.findUnique({
      where: { id: appointment.id },
      select: { totalAmount: true, insurancePlanId: true },
    })
    assert.equal(after.totalAmount, 320, "convênio NÃO altera o valor praticado")
    assert.equal(after.insurancePlanId, plan.id)
  })

  await test("convênio com nome duplicado é rejeitado", async () => {
    const name = `Duplicado ${uniq()}`
    const first = await expenseService.createInsurancePlan({ name, kind: "convenio" })
    assert.ok(!isFinancialError(first))

    const second = await expenseService.createInsurancePlan({ name, kind: "convenio" })
    assert.ok(isFinancialError(second))
    assert.equal(second.status, 409)
  })

  await test("convênio com tipo inválido é rejeitado", async () => {
    const result = await expenseService.createInsurancePlan({
      name: `Inválido ${uniq()}`,
      kind: "plano_maluco",
    })
    assert.ok(isFinancialError(result))
    assert.equal(result.code, "INVALID_INPUT")
  })

  // -------------------------------------------------------------------------
  section("NÃO DUPLICAÇÃO — uma fonte por conceito")
  // -------------------------------------------------------------------------

  await test("NÃO existe tabela financeira paralela de pagamentos", async () => {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%financial_payment%' OR name LIKE '%financial_payments%')"
    )
    assert.equal(rows.length, 0, "pagamentos continuam apenas em `payments`")
  })

  await test("NÃO existe segunda tabela de procedimentos no Financeiro", async () => {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%financial%proced%'"
    )
    assert.equal(rows.length, 0, "catálogo segue único em `procedures`")
  })

  await test("cada pagamento tem no máximo UMA movimentação (payment_id único)", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 130 })
    const payment = await makePayment(appointment.id, { amount: 130 })

    await service.syncIncomeFromPayments()
    await service.syncIncomeFromPayments()
    await service.syncIncomeFromPayment(payment.id)

    const count = await prisma.financialTransaction.count({
      where: { paymentId: payment.id },
    })
    assert.equal(count, 1)
  })

  await test("toda receita consolidada tem origem em um pagamento", async () => {
    await service.syncIncomeFromPayments()
    const orphan = await prisma.financialTransaction.count({
      where: { direction: "in", paymentId: null },
    })
    assert.equal(orphan, 0, "não existe receita sem pagamento de origem")
  })

  await test("toda despesa consolidada tem origem em uma despesa", async () => {
    const orphan = await prisma.financialTransaction.count({
      where: { direction: "out", expenseId: null },
    })
    assert.equal(orphan, 0, "não existe saída sem despesa de origem")
  })

  await test("toda movimentação é in OU out, nunca ambos", async () => {
    const invalid = await prisma.financialTransaction.count({
      where: {
        NOT: [{ direction: "in" }, { direction: "out" }],
      },
    })
    assert.equal(invalid, 0)
  })

  await test("o catálogo de procedimentos não é alterado pelo Financeiro", async () => {
    const procedure = await makeProcedure(275)
    const before = await prisma.procedure.findUnique({ where: { id: procedure.id } })

    const { appointment } = await makeAppointment({ totalAmount: 275 })
    await makePayment(appointment.id, { amount: 275 })
    await service.syncIncomeFromPayments()

    const after = await prisma.procedure.findUnique({ where: { id: procedure.id } })
    assert.deepEqual(
      { name: after.name, price: after.defaultPrice, code: after.code },
      { name: before.name, price: before.defaultPrice, code: before.code }
    )
  })

  await test("a contagem de pacientes não muda por causa do Financeiro", async () => {
    const before = await prisma.patient.count()
    await service.syncIncomeFromPayments()
    const after = await prisma.patient.count()
    assert.equal(after, before, "nenhum paciente é duplicado")
  })
}

// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — FINANCEIRO (Financeiro 1).
// ===========================================================================
// Exercita o SERVIÇO REAL contra um banco SQLite descartável.
//
// COBERTURA DE SEGURANÇA DESTA FASE
// Como NÃO existe autenticação real nem multi-tenancy (decisões 2-A e 3-A),
// os testes aqui NÃO simulam "usuário sem permissão" nem "clínica A x B".
// Em vez disso testam o que É real e verificável:
//   1. IDs inválidos / recursos inexistentes;
//   2. paciente inexistente / atendimento inexistente;
//   3. relacionamento inválido;
//   4. patientId que não corresponde ao atendimento (CONTEXT_MISMATCH);
//   5. validação de dados no backend;
//   6. isolamento lógico: o paciente é sempre derivado do servidor;
//   7. estados inválidos (despesa paga não é editável, etc.).

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0
const uniq = () => `${Date.now()}-${++seq}`

/**
 * Data LOCAL a partir de "YYYY-MM-DD".
 *
 * `new Date("2026-09-10")` seria interpretado como UTC meia-noite e, no fuso do
 * Brasil, cairia no dia anterior às 21h. O serviço de dashboard resolve o
 * período em horário LOCAL, então os fixtures usam a mesma convenção.
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

// ---------------------------------------------------------------------------
// Cenários
// ---------------------------------------------------------------------------

export async function runIntegrationScenarios() {
  const { isFinancialError } = service

  // -------------------------------------------------------------------------
  section("Sincronização — pagamento é a FONTE, movimentação é derivação")
  // -------------------------------------------------------------------------

  await test("pagamento efetivado gera UMA movimentação de receita", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 150 })
    const payment = await makePayment(appointment.id, { amount: 150 })

    const result = await service.syncIncomeFromPayments()
    assert.ok(result.scanned >= 1)

    const txs = await prisma.financialTransaction.findMany({
      where: { paymentId: payment.id },
    })
    assert.equal(txs.length, 1, "exatamente uma movimentação por pagamento")
    assert.equal(txs[0].direction, "in")
    assert.equal(txs[0].status, "settled")
    assert.equal(txs[0].amount, 150)
  })

  await test("o paciente da movimentação é DERIVADO do atendimento", async () => {
    const { appointment, patient } = await makeAppointment({ totalAmount: 300 })
    const payment = await makePayment(appointment.id, { amount: 300 })

    await service.syncIncomeFromPayments()
    const tx = await prisma.financialTransaction.findUnique({
      where: { paymentId: payment.id },
      select: { patientId: true, appointmentId: true },
    })

    assert.equal(tx.patientId, patient.id, "paciente herdado do atendimento")
    assert.equal(tx.appointmentId, appointment.id)
  })

  await test("sincronizar duas vezes NÃO duplica movimentações (idempotente)", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 80 })
    const payment = await makePayment(appointment.id, { amount: 80 })

    await service.syncIncomeFromPayments()
    const first = await prisma.financialTransaction.count({
      where: { paymentId: payment.id },
    })

    const second = await service.syncIncomeFromPayments()
    const after = await prisma.financialTransaction.count({
      where: { paymentId: payment.id },
    })

    assert.equal(first, 1)
    assert.equal(after, 1, "segunda execução não criou duplicata")
    assert.equal(second.created, 0, "nada novo foi criado")
  })

  await test("mudança de status do pagamento é refletida na movimentação", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 120 })
    const payment = await makePayment(appointment.id, {
      amount: 120,
      status: "pending",
      paidAt: null,
    })

    await service.syncIncomeFromPayments()
    let tx = await prisma.financialTransaction.findUnique({
      where: { paymentId: payment.id },
    })
    assert.equal(tx.status, "pending", "pendente origina previsão")

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "paid", paidAt: new Date("2026-09-11T10:00:00") },
    })
    await service.syncIncomeFromPayments()

    tx = await prisma.financialTransaction.findUnique({
      where: { paymentId: payment.id },
    })
    assert.equal(tx.status, "settled", "quitado passa a efetivado")
  })

  await test("pagamento estornado fica fora do caixa", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 90 })
    const payment = await makePayment(appointment.id, {
      amount: 90,
      status: "refunded",
    })

    await service.syncIncomeFromPayments()
    const tx = await prisma.financialTransaction.findUnique({
      where: { paymentId: payment.id },
    })
    assert.equal(tx.status, "reversed")
  })

  await test("sincronizar NÃO altera nem apaga o pagamento original", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 70 })
    const payment = await makePayment(appointment.id, { amount: 70 })

    const before = await prisma.payment.findUnique({ where: { id: payment.id } })
    await service.syncIncomeFromPayments()
    const after = await prisma.payment.findUnique({ where: { id: payment.id } })

    assert.deepEqual(
      { amount: after.amount, status: after.status, method: after.paymentMethod },
      { amount: before.amount, status: before.status, method: before.paymentMethod }
    )
  })

  await test("syncIncomeFromPayment ignora pagamento inexistente (não lança)", async () => {
    const result = await service.syncIncomeFromPayment("pagamento-inexistente")
    assert.equal(result, null)
  })

  // -------------------------------------------------------------------------
  section("Despesas — contexto resolvido no servidor")
  // -------------------------------------------------------------------------

  let categoryId

  await test("categorias padrão são criadas de forma idempotente", async () => {
    const created = await expenseService.ensureDefaultExpenseCategories()
    assert.ok(created > 0, "primeira execução cria as categorias")

    const again = await expenseService.ensureDefaultExpenseCategories()
    assert.equal(again, 0, "segunda execução não cria nada")

    const list = await expenseService.listExpenseCategories()
    categoryId = list[0].id
    assert.ok(list.length >= 10)
  })

  await test("despesa sem categoria é rejeitada", async () => {
    const result = await expenseService.createExpense(
      {
        categoryId: "",
        description: "Compra",
        amount: 100,
        competenceDate: "2026-09-01",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(isFinancialError(result))
    assert.equal(result.code, "INVALID_INPUT")
  })

  await test("categoria inexistente é rejeitada (404)", async () => {
    const result = await expenseService.createExpense(
      {
        categoryId: "categoria-inexistente",
        description: "Compra",
        amount: 100,
        competenceDate: "2026-09-01",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(isFinancialError(result))
    assert.equal(result.code, "CATEGORY_NOT_FOUND")
    assert.equal(result.status, 404)
  })

  await test("valor zero ou negativo é rejeitado", async () => {
    for (const amount of [0, -50]) {
      const result = await expenseService.createExpense(
        {
          categoryId,
          description: "Compra",
          amount,
          competenceDate: "2026-09-01",
        },
        { userId: null, name: "Ana" }
      )
      assert.ok(isFinancialError(result), `valor ${amount} deve ser rejeitado`)
    }
  })

  await test("data de competência inválida é rejeitada", async () => {
    const result = await expenseService.createExpense(
      {
        categoryId,
        description: "Compra",
        amount: 100,
        competenceDate: "01/09/2026",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(isFinancialError(result))
    assert.equal(result.code, "INVALID_INPUT")
  })

  await test("atendimento inexistente é rejeitado (404)", async () => {
    const result = await expenseService.createExpense(
      {
        categoryId,
        description: "Material",
        amount: 100,
        competenceDate: "2026-09-01",
        appointmentId: "atendimento-inexistente",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(isFinancialError(result))
    assert.equal(result.code, "APPOINTMENT_NOT_FOUND")
  })

  await test("paciente inexistente é rejeitado (404)", async () => {
    const result = await expenseService.createExpense(
      {
        categoryId,
        description: "Material",
        amount: 100,
        competenceDate: "2026-09-01",
        patientId: "paciente-inexistente",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(isFinancialError(result))
    assert.equal(result.code, "PATIENT_NOT_FOUND")
  })

  await test("SEGURANÇA: patientId divergente do atendimento é REJEITADO", async () => {
    const { appointment } = await makeAppointment()
    const outroPaciente = await makePatient("Outro Paciente")

    // O cliente tenta associar a despesa a um paciente que NÃO é o do
    // atendimento. O servidor não obedece: rejeita o contexto.
    const result = await expenseService.createExpense(
      {
        categoryId,
        description: "Tentativa de contexto cruzado",
        amount: 100,
        competenceDate: "2026-09-01",
        appointmentId: appointment.id,
        patientId: outroPaciente.id,
      },
      { userId: null, name: "Ana" }
    )

    assert.ok(isFinancialError(result), "deve rejeitar")
    assert.equal(result.code, "CONTEXT_MISMATCH")
    assert.equal(result.status, 409)
  })

  await test("despesa geral (sem atendimento) é aceita sem paciente", async () => {
    const result = await expenseService.createExpense(
      {
        categoryId,
        description: "Aluguel do consultório",
        amount: 1200,
        competenceDate: "2026-09-05",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(result), "despesa geral deve ser criada")

    const expense = await prisma.expense.findUnique({
      where: { id: result.id },
      select: { patientId: true, appointmentId: true, status: true },
    })
    assert.equal(expense.patientId, null)
    assert.equal(expense.appointmentId, null)
    assert.equal(expense.status, "pending")
  })

  await test("despesa cria movimentação de saída DERIVADA", async () => {
    const result = await expenseService.createExpense(
      {
        categoryId,
        description: "Material de consumo",
        amount: 250,
        competenceDate: "2026-09-07",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(result))

    const txs = await prisma.financialTransaction.findMany({
      where: { expenseId: result.id },
    })
    assert.equal(txs.length, 1, "uma movimentação por despesa")
    assert.equal(txs[0].direction, "out")
    assert.equal(txs[0].status, "pending")
    assert.equal(txs[0].amount, 250)
    assert.equal(txs[0].paymentId, null, "despesa não referencia pagamento")
  })

  await test("despesa já quitada nasce com movimentação efetivada", async () => {
    const result = await expenseService.createExpense(
      {
        categoryId,
        description: "Compra paga à vista",
        amount: 300,
        competenceDate: "2026-09-08",
        markAsPaid: true,
        paymentMethod: "dinheiro",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(result))

    const tx = await prisma.financialTransaction.findFirst({
      where: { expenseId: result.id },
    })
    assert.equal(tx.status, "settled")
    assert.equal(tx.paymentMethod, "dinheiro")
  })

  await test("quitar despesa é idempotente (não duplica movimentação)", async () => {
    const created = await expenseService.createExpense(
      {
        categoryId,
        description: "Despesa a quitar",
        amount: 180,
        competenceDate: "2026-09-09",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(created))

    await expenseService.payExpense(
      created.id,
      { paymentMethod: "pix" },
      { userId: null, name: "Ana" }
    )
    await expenseService.payExpense(
      created.id,
      { paymentMethod: "pix" },
      { userId: null, name: "Ana" }
    )

    const count = await prisma.financialTransaction.count({
      where: { expenseId: created.id },
    })
    assert.equal(count, 1, "quitar duas vezes não duplica")

    const expense = await prisma.expense.findUnique({ where: { id: created.id } })
    assert.equal(expense.status, "paid")
  })

  await test("despesa cancelada não pode ser paga", async () => {
    const created = await expenseService.createExpense(
      {
        categoryId,
        description: "Despesa cancelada",
        amount: 90,
        competenceDate: "2026-09-09",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(created))

    const cancelled = await expenseService.cancelExpense(created.id, "Duplicidade", {
      userId: null,
      name: "Ana",
    })
    assert.ok(!isFinancialError(cancelled))

    const pay = await expenseService.payExpense(
      created.id,
      {},
      { userId: null, name: "Ana" }
    )
    assert.ok(isFinancialError(pay))
    assert.equal(pay.code, "INVALID_STATE")
  })

  await test("cancelar despesa cancela a movimentação e PRESERVA o registro", async () => {
    const created = await expenseService.createExpense(
      {
        categoryId,
        description: "Despesa para cancelar",
        amount: 75,
        competenceDate: "2026-09-09",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(created))

    await expenseService.cancelExpense(created.id, "Erro de lançamento", {
      userId: null,
      name: "Bruna",
    })

    const expense = await prisma.expense.findUnique({ where: { id: created.id } })
    assert.equal(expense.status, "cancelled", "registro preservado, não apagado")
    assert.equal(expense.cancelReason, "Erro de lançamento")
    assert.equal(expense.cancelledByName, "Bruna")

    const tx = await prisma.financialTransaction.findFirst({
      where: { expenseId: created.id },
    })
    assert.equal(tx.status, "cancelled", "movimentação acompanha o cancelamento")
  })

  await test("cancelar duas vezes é rejeitado", async () => {
    const created = await expenseService.createExpense(
      {
        categoryId,
        description: "Cancelar duas vezes",
        amount: 60,
        competenceDate: "2026-09-09",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(created))

    await expenseService.cancelExpense(created.id, null, { userId: null, name: "Ana" })
    const again = await expenseService.cancelExpense(created.id, null, {
      userId: null,
      name: "Ana",
    })
    assert.ok(isFinancialError(again))
    assert.equal(again.code, "INVALID_STATE")
  })

  await test("despesa quitada é imutável", async () => {
    const created = await expenseService.createExpense(
      {
        categoryId,
        description: "Despesa quitada",
        amount: 110,
        competenceDate: "2026-09-09",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(created))
    await expenseService.payExpense(created.id, {}, { userId: null, name: "Ana" })

    const update = await expenseService.updateExpense(created.id, { amount: 500 })
    assert.ok(isFinancialError(update))
    assert.equal(update.code, "INVALID_STATE")
  })

  await test("despesa em aberto pode ser editada e a movimentação acompanha", async () => {
    const created = await expenseService.createExpense(
      {
        categoryId,
        description: "Despesa editável",
        amount: 100,
        competenceDate: "2026-09-09",
      },
      { userId: null, name: "Ana" }
    )
    assert.ok(!isFinancialError(created))

    const updated = await expenseService.updateExpense(created.id, { amount: 175 })
    assert.ok(!isFinancialError(updated))

    const tx = await prisma.financialTransaction.findFirst({
      where: { expenseId: created.id },
    })
    assert.equal(tx.amount, 175, "movimentação reflete o valor atualizado")
  })

  await test("marcar como pago usa o nome do ATOR como atribuição textual", async () => {
    const created = await expenseService.createExpense(
      {
        categoryId,
        description: "Despesa com autor",
        amount: 40,
        competenceDate: "2026-09-09",
      },
      { userId: null, name: "Dra. Carla" }
    )
    assert.ok(!isFinancialError(created))

    await expenseService.payExpense(
      created.id,
      {},
      { userId: null, name: "Dra. Carla" }
    )
    const expense = await prisma.expense.findUnique({ where: { id: created.id } })
    assert.equal(expense.paidByName, "Dra. Carla")
    assert.equal(expense.createdByName, "Dra. Carla")
    assert.equal(expense.createdById, null, "sem autenticação real, id fica null")
  })

  await test("nome ausente vira marcador, nunca string vazia", async () => {
    const created = await expenseService.createExpense(
      {
        categoryId,
        description: "Sem autor informado",
        amount: 30,
        competenceDate: "2026-09-09",
      },
      { userId: null, name: "   " }
    )
    assert.ok(!isFinancialError(created))
    const expense = await prisma.expense.findUnique({ where: { id: created.id } })
    assert.equal(expense.createdByName, "Não informado")
  })

  return { categoryId }
}

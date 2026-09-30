// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — DESPESAS (Financeiro 4, implementação CONSOLIDADA).
// ===========================================================================
//
// Exercita o SERVIÇO CANÔNICO REAL (`financial-expense-service`) contra um
// SQLite descartável. Cobre: criação, consulta, filtros, summary, pagamento
// único, pagamento parcial, pagamentos múltiplos, quitação, vencimento,
// cancelamento, auditoria, concorrência e idempotência.
//
// Este arquivo substitui a ausência histórica de testes da implementação que
// detinha pagamentos múltiplos (ex-"B") e é a cobertura oficial da versão
// consolidada.

import {
  prisma,
  expenseService,
  section,
  test,
  assert,
} from "./_financial-harness.mjs"

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

function localDate(iso) {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function isoDaysFromNow(days) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`
}

async function makeCategory() {
  const r = await expenseService.createExpenseCategory({
    name: `Cat ${uniq()}`,
    kind: "operacional",
  })
  if (r && r.code) throw new Error("Falha ao criar categoria: " + r.error)
  return r.id
}

async function makeExpense(overrides = {}) {
  const categoryId = overrides.categoryId ?? (await makeCategory())
  const r = await expenseService.createDespesa(
    {
      categoryId,
      description: overrides.description ?? `Despesa ${uniq()}`,
      amount: overrides.amount ?? 1000,
      competenceDate: overrides.competenceDate ?? isoDaysFromNow(0),
      dueDate: overrides.dueDate ?? isoDaysFromNow(30),
      ...overrides,
    },
    { userId: null, name: "Teste" }
  )
  if (r && r.code) throw new Error("Falha ao criar despesa: " + r.error)
  return r.id
}

export async function runDespesasScenarios() {
  // -------------------------------------------------------------------------
  section("Despesas — criação e consulta")
  // -------------------------------------------------------------------------

  await test("cria despesa PENDENTE e gera movimentação pending", async () => {
    const id = await makeExpense({ amount: 500 })
    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.status, "PENDENTE")
    assert.equal(detail.amount, 500)
    assert.equal(detail.balance, 500)
    assert.equal(detail.paidAmount, 0)

    const tx = await prisma.financialTransaction.findFirst({ where: { expenseId: id } })
    assert.ok(tx, "movimentação derivada deve existir")
    assert.equal(tx.direction, "out")
    assert.equal(tx.status, "pending")
  })

  await test("cria despesa já quitada (markAsPaid) e gera pagamento + movimentação settled", async () => {
    const id = await makeExpense({ amount: 300, markAsPaid: true })
    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.status, "PAGA")
    assert.equal(detail.balance, 0)
    assert.equal(detail.payments.length, 1)

    const tx = await prisma.financialTransaction.findFirst({ where: { expenseId: id } })
    assert.equal(tx.status, "settled")
    assert.equal(tx.amount, 300)
  })

  await test("rejeita despesa com valor zero/negativo", async () => {
    const categoryId = await makeCategory()
    const r = await expenseService.createDespesa(
      { categoryId, description: "Inválida", amount: 0, competenceDate: isoDaysFromNow(0) },
      { userId: null, name: "T" }
    )
    assert.ok(r.code, "deve retornar erro")
    assert.equal(r.status, 400)
  })

  await test("rejeita despesa com categoria inexistente", async () => {
    const r = await expenseService.createDespesa(
      {
        categoryId: "nao-existe",
        description: "Sem categoria",
        amount: 10,
        competenceDate: isoDaysFromNow(0),
      },
      { userId: null, name: "T" }
    )
    assert.ok(r.code)
    assert.equal(r.status, 404)
  })

  await test("rejeita despesa com categoria INATIVA", async () => {
    const categoryId = await makeCategory()
    await expenseService.setExpenseCategoryActive(categoryId, false)
    const r = await expenseService.createDespesa(
      { categoryId, description: "Inativa", amount: 10, competenceDate: isoDaysFromNow(0) },
      { userId: null, name: "T" }
    )
    assert.ok(r.code)
    assert.equal(r.status, 400)
  })

  // -------------------------------------------------------------------------
  section("Despesas — pagamento único / parcial / múltiplos / quitação")
  // -------------------------------------------------------------------------

  await test("pagamento parcial muda status para PARCIAL e mantém saldo", async () => {
    const id = await makeExpense({ amount: 1000 })
    const p1 = await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 300, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )
    assert.equal(p1.balanceBefore, 1000)
    assert.equal(p1.balanceAfter, 700)
    assert.equal(p1.status, "PARCIAL")

    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.paidAmount, 300)
    assert.equal(detail.balance, 700)
    assert.equal(detail.status, "PARCIAL")
  })

  await test("pagamentos múltiplos somam até a quitação (PAGA / saldo 0)", async () => {
    const id = await makeExpense({ amount: 1000 })
    await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 300, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )
    await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 200, paymentMethod: "dinheiro" },
      { userId: null, name: "T" }
    )
    let detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.paidAmount, 500)
    assert.equal(detail.balance, 500)
    assert.equal(detail.status, "PARCIAL")

    const p3 = await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 500, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )
    assert.equal(p3.balanceAfter, 0)
    assert.equal(p3.status, "PAGA")

    detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.status, "PAGA")
    assert.equal(detail.balance, 0)
    assert.equal(detail.payments.length, 3)

    const tx = await prisma.financialTransaction.findFirst({ where: { expenseId: id } })
    assert.equal(tx.status, "settled")
    assert.equal(tx.amount, 1000)
  })

  await test("proíbe pagamento acima do saldo", async () => {
    const id = await makeExpense({ amount: 1000 })
    const r = await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 1500, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )
    assert.ok(r.code)
    assert.equal(r.status, 400)
    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.paidAmount, 0, "nenhum pagamento deve ter sido registrado")
  })

  await test("proíbe pagar despesa já quitada", async () => {
    const id = await makeExpense({ amount: 100 })
    await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 100, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )
    const r = await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 1, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )
    assert.ok(r.code)
    assert.equal(r.status, 409)
  })

  await test("proíbe forma de pagamento inválida", async () => {
    const id = await makeExpense({ amount: 100 })
    const r = await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 50, paymentMethod: "cheque_voando" },
      { userId: null, name: "T" }
    )
    assert.ok(r.code)
    assert.equal(r.status, 400)
  })

  await test("payExpense quita integralmente e é idempotente", async () => {
    const id = await makeExpense({ amount: 400 })
    const r1 = await expenseService.payExpense(id, { paymentMethod: "pix" }, {
      userId: null,
      name: "T",
    })
    assert.ok(!r1.code)
    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.status, "PAGA")

    const r2 = await expenseService.payExpense(id, { paymentMethod: "pix" }, {
      userId: null,
      name: "T",
    })
    assert.ok(r2.code, "segunda quitação deve falhar (já quitada)")
    assert.equal(r2.status, 409)
    const detail2 = await expenseService.getDespesaDetail(id)
    assert.equal(detail2.payments.length, 1, "não pode duplicar pagamento")
  })

  // -------------------------------------------------------------------------
  section("Despesas — vencimento e status derivado")
  // -------------------------------------------------------------------------

  await test("despesa vencida (saldo>0 e vencimento no passado) → VENCIDA", async () => {
    const id = await makeExpense({ amount: 500, dueDate: isoDaysFromNow(-3) })
    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.status, "VENCIDA")
  })

  await test("parcial vencida continua VENCIDA (vencimento precede PARCIAL)", async () => {
    const id = await makeExpense({ amount: 500, dueDate: isoDaysFromNow(-3) })
    await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 100, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )
    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.status, "VENCIDA")
  })

  await test("deriveDespesaStatus: cancelada tem precedência total", async () => {
    const s = expenseService.deriveDespesaStatus({
      cancelled: true,
      balance: 10,
      paidAmount: 0,
      dueDate: null,
    })
    assert.equal(s, "CANCELADA")
  })

  await test("vence HOJE não é VENCIDA (comparação por dia)", async () => {
    const id = await makeExpense({ amount: 500, dueDate: isoDaysFromNow(0) })
    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.status, "PENDENTE")
  })

  // -------------------------------------------------------------------------
  section("Despesas — cancelamento")
  // -------------------------------------------------------------------------

  await test("cancelar despesa muda status, cancela movimentação e é idempotente", async () => {
    const id = await makeExpense({ amount: 250 })
    const r = await expenseService.cancelDespesa(id, "fornecedor errado", {
      userId: null,
      name: "T",
    })
    assert.ok(!r.code)

    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.status, "CANCELADA")
    assert.equal(detail.cancelReason, "fornecedor errado")

    const tx = await prisma.financialTransaction.findFirst({ where: { expenseId: id } })
    assert.equal(tx.status, "cancelled")

    const r2 = await expenseService.cancelDespesa(id, null, { userId: null, name: "T" })
    assert.ok(r2.code)
    assert.equal(r2.status, 409)
  })

  await test("despesa cancelada não aceita pagamento", async () => {
    const id = await makeExpense({ amount: 250 })
    await expenseService.cancelDespesa(id, null, { userId: null, name: "T" })
    const r = await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 10, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )
    assert.ok(r.code)
    assert.equal(r.status, 409)
  })

  // -------------------------------------------------------------------------
  section("Despesas — edição")
  // -------------------------------------------------------------------------

  await test("edição altera valor/descrição e sincroniza a movimentação", async () => {
    const id = await makeExpense({ amount: 100, description: "Antes" })
    const r = await expenseService.updateDespesa(
      id,
      { amount: 200, description: "Depois" },
      { userId: null, name: "T" }
    )
    assert.ok(!r.code)
    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.amount, 200)
    assert.equal(detail.description, "Depois")

    const tx = await prisma.financialTransaction.findFirst({ where: { expenseId: id } })
    assert.equal(tx.amount, 200)
    assert.equal(tx.description, "Depois")
  })

  await test("não permite reduzir valor abaixo do já pago", async () => {
    const id = await makeExpense({ amount: 1000 })
    await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 600, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )
    const r = await expenseService.updateDespesa(
      id,
      { amount: 500 },
      { userId: null, name: "T" }
    )
    assert.ok(r.code)
    assert.equal(r.status, 400)
  })

  await test("não edita despesa cancelada", async () => {
    const id = await makeExpense({ amount: 100 })
    await expenseService.cancelDespesa(id, null, { userId: null, name: "T" })
    const r = await expenseService.updateDespesa(
      id,
      { amount: 200 },
      { userId: null, name: "T" }
    )
    assert.ok(r.code)
    assert.equal(r.status, 409)
  })

  // -------------------------------------------------------------------------
  section("Despesas — listagem, filtros e summary")
  // -------------------------------------------------------------------------

  await test("listDespesas retorna summary e paginação coerentes", async () => {
    const stamp = uniq()
    const catId = await makeCategory()
    const mk = (amount, dueOffset) =>
      expenseService.createDespesa(
        {
          categoryId: catId,
          description: `Lista ${stamp}`,
          amount,
          competenceDate: isoDaysFromNow(0),
          dueDate: isoDaysFromNow(dueOffset),
        },
        { userId: null, name: "T" }
      )
    await mk(100, 10)
    await mk(200, -5) // vencida
    const paid = await mk(300, 10)
    await expenseService.registerDespesaPayment(
      { expenseId: paid.id, amount: 300, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )

    const result = await expenseService.listDespesas({
      period: "all",
      search: `Lista ${stamp}`,
      page: 1,
      pageSize: 20,
    })

    assert.equal(result.summary.totalCount, 3)
    assert.equal(result.summary.paidCount, 1)
    assert.equal(result.summary.pendingCount, 2)
    assert.equal(result.summary.overdueCount, 1)
    assert.equal(result.summary.totalExpenses, 600)
    assert.equal(result.summary.totalPaid, 300)
    assert.equal(result.summary.totalPending, 300)
    assert.equal(result.summary.totalOverdue, 200)
    assert.equal(result.despesas.length, 3)
  })

  await test("filtro por status VENCIDA usa vencimento derivado", async () => {
    const stamp = uniq()
    const catId = await makeCategory()
    await expenseService.createDespesa(
      {
        categoryId: catId,
        description: `Vencida ${stamp}`,
        amount: 77,
        competenceDate: isoDaysFromNow(0),
        dueDate: isoDaysFromNow(-1),
      },
      { userId: null, name: "T" }
    )
    await expenseService.createDespesa(
      {
        categoryId: catId,
        description: `Futura ${stamp}`,
        amount: 88,
        competenceDate: isoDaysFromNow(0),
        dueDate: isoDaysFromNow(5),
      },
      { userId: null, name: "T" }
    )

    const result = await expenseService.listDespesas({
      period: "all",
      status: "VENCIDA",
      search: stamp,
      page: 1,
      pageSize: 20,
    })
    assert.ok(result.despesas.every((d) => d.status === "VENCIDA"))
    assert.equal(result.despesas.length, 1)
  })

  await test("paginação limita o número de itens retornados", async () => {
    const stamp = uniq()
    const catId = await makeCategory()
    for (let i = 0; i < 5; i++) {
      await expenseService.createDespesa(
        {
          categoryId: catId,
          description: `Pag ${stamp} ${i}`,
          amount: 10,
          competenceDate: isoDaysFromNow(0),
        },
        { userId: null, name: "T" }
      )
    }
    const page1 = await expenseService.listDespesas({
      period: "all",
      search: `Pag ${stamp}`,
      page: 1,
      pageSize: 2,
    })
    assert.equal(page1.despesas.length, 2)
    assert.equal(page1.pagination.totalCount, 5)
    assert.equal(page1.pagination.totalPages, 3)
    assert.ok(page1.pagination.hasNext)
  })

  // -------------------------------------------------------------------------
  section("Despesas — auditoria (ExpenseLog)")
  // -------------------------------------------------------------------------

  await test("registra logs de criação, pagamento e cancelamento", async () => {
    const id = await makeExpense({ amount: 500 })
    await expenseService.registerDespesaPayment(
      { expenseId: id, amount: 200, paymentMethod: "pix" },
      { userId: null, name: "T" }
    )
    await expenseService.cancelDespesa(id, "teste auditoria", {
      userId: null,
      name: "T",
    })

    const detail = await expenseService.getDespesaDetail(id)
    const events = detail.logs.map((l) => l.event)
    assert.ok(events.includes("created"), "deve ter log de criação")
    assert.ok(events.includes("payment"), "deve ter log de pagamento parcial")
    assert.ok(events.includes("cancelled"), "deve ter log de cancelamento")
  })

  // -------------------------------------------------------------------------
  section("Despesas — concorrência e idempotência")
  // -------------------------------------------------------------------------

  await test("dois pagamentos simultâneos não excedem o saldo", async () => {
    const id = await makeExpense({ amount: 500 })
    const [a, b] = await Promise.all([
      expenseService.registerDespesaPayment(
        { expenseId: id, amount: 500, paymentMethod: "pix" },
        { userId: null, name: "A" }
      ),
      expenseService.registerDespesaPayment(
        { expenseId: id, amount: 500, paymentMethod: "pix" },
        { userId: null, name: "B" }
      ),
    ])
    const okCount = [a, b].filter((r) => !r.code).length
    const detail = await expenseService.getDespesaDetail(id)
    assert.equal(detail.paidAmount, 500, "nunca pode pagar além do valor")
    assert.equal(detail.balance, 0)
    assert.equal(detail.status, "PAGA")
    assert.ok(okCount >= 1, "ao menos um pagamento deve concluir")
  })

  // -------------------------------------------------------------------------
  section("Despesas — categorias (fonte única)")
  // -------------------------------------------------------------------------

  await test("ensureDefaultExpenseCategories é idempotente", async () => {
    const first = await expenseService.ensureDefaultExpenseCategories()
    const second = await expenseService.ensureDefaultExpenseCategories()
    assert.equal(second, 0, "segunda execução não deve criar nada")
    const cats = await expenseService.listExpenseCategories()
    assert.ok(cats.length >= 20, "categorias padrão devem existir")
    assert.ok(first >= 0)
  })

  await test("não cria categoria com nome duplicado", async () => {
    const name = `Dup ${uniq()}`
    const r1 = await expenseService.createExpenseCategory({ name, kind: "operacional" })
    assert.ok(!r1.code)
    const r2 = await expenseService.createExpenseCategory({ name, kind: "operacional" })
    assert.ok(r2.code)
    assert.equal(r2.status, 409)
  })

  await test("kind inválido de categoria é rejeitado", async () => {
    const r = await expenseService.createExpenseCategory({
      name: `Kind ${uniq()}`,
      kind: "inexistente",
    })
    assert.ok(r.code)
    assert.equal(r.status, 400)
  })
}

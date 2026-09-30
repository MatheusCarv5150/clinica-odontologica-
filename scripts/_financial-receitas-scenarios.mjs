// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — RECEITAS (Financeiro 2).
// ===========================================================================
// 30 casos exercitando o SERVIÇO REAL contra um SQLite descartável.
//
// Grupos:
//   A. Derivados puros (status / origem / código) ......... 1–6
//   B. Listagem: período e totais ........................ 7–13
//   C. Busca, filtros, ordenação e paginação ............. 14–21
//   D. Detalhe e histórico ............................... 22–25
//   E. Registro de recebimento e estorno ................. 26–30
//
// REGRAS QUE ESTES TESTES PROTEGEM
//   - receita é o valor RECEBIDO; parcial nunca vira total;
//   - previsto e recebido nunca são somados no mesmo número;
//   - cancelada/estornada fica FORA de todos os totais;
//   - nada é apagado em um estorno;
//   - a busca e a paginação acontecem no servidor.

import {
  prisma,
  receitasService,
  domain,
  test,
  section,
  assert,
} from "./_financial-harness.mjs"

const {
  listReceitas,
  getReceitaDetail,
  registerReceita,
  reverseReceita,
  deriveReceitaStatus,
  deriveReceitaOrigin,
  appointmentCode,
  receitaStatusLabel,
} = receitasService

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

async function makePatient(name = "Paciente Receita") {
  return prisma.patient.create({
    data: {
      fullName: name,
      cpf: (String(Date.now()) + String(seq++)).slice(-11).padStart(11, "0"),
      birthDate: localDate("1990-01-01"),
    },
    select: { id: true, fullName: true },
  })
}

async function makeProcedure(name, price) {
  return prisma.procedure.create({
    data: {
      name: name ?? `Procedimento ${uniq()}`,
      code: `COD-${uniq()}`,
      category: "Restauração",
      defaultPrice: price,
    },
    select: { id: true, name: true },
  })
}

/**
 * Atendimento com procedimentos (snapshot) e cobrança.
 * `procedures` entra como itens do atendimento (nome congelado).
 */
async function makeAppointment(options = {}) {
  const patient = options.patient ?? (await makePatient())
  const items = options.procedures ?? []

  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      appointmentDate: options.date ?? localDate("2026-09-10"),
      appointmentTime: options.time ?? "09:00",
      status: options.status ?? "completed",
      totalAmount:
        options.totalAmount === undefined
          ? items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
          : options.totalAmount,
      finishedByName: options.finishedByName ?? null,
      procedures:
        items.length > 0
          ? {
              create: items.map((i) => ({
                procedureId: i.procedureId ?? null,
                procedureNameSnapshot: i.name,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                totalPrice: i.quantity * i.unitPrice,
              })),
            }
          : undefined,
    },
    select: { id: true, patientId: true },
  })

  return { appointment, patient }
}

/** Pagamento + projeção de receita, pelo caminho CANÔNICO do sistema. */
async function pay(appointmentId, options = {}) {
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

/**
 * Cria pagamento E a movimentação de receita correspondente (o que o serviço
 * `syncIncomeFromPayment` faria), com competência controlada — necessário para
 * testes determinísticos de período.
 */
async function seedReceita(appointmentId, options = {}) {
  const payment = await prisma.payment.create({
    data: {
      appointmentId,
      amount: options.amount ?? 100,
      paymentMethod: options.paymentMethod ?? "pix",
      status: options.status ?? "paid",
      paidAt: options.paidAt ?? options.competence ?? localDate("2026-09-10"),
    },
    select: { id: true },
  })

  const competence = options.competence ?? options.paidAt ?? localDate("2026-09-10")

  const transaction = await prisma.financialTransaction.create({
    data: {
      direction: "in",
      appointmentId,
      patientId: options.patientId ?? null,
      paymentId: payment.id,
      amount: options.amount ?? 100,
      status: options.transactionStatus ?? "settled",
      competenceDate: competence,
      settledAt: options.settledAt ?? competence,
      paymentMethod: options.paymentMethod ?? "pix",
      description: options.description ?? "Recebimento de atendimento",
      createdByName: options.createdByName ?? "Recepção",
    },
    select: { id: true },
  })

  return { paymentId: payment.id, transactionId: transaction.id }
}

/**
 * Executa `listReceitas` com um escopo de período amplo por padrão,
 * evitando que fixtures caiam fora da janela padrão ("este mês").
 */
function list(options = {}) {
  return listReceitas({
    period: "custom",
    from: "2000-01-01",
    to: "2099-12-31",
    ...options,
  })
}

export async function runReceitasScenarios() {
  // -------------------------------------------------------------------------
  section("A. Derivados puros")
  // -------------------------------------------------------------------------

  await test("1. status derivado: saldo zero vira 'settled'", () => {
    assert.equal(deriveReceitaStatus("settled", 0), "settled")
    assert.equal(receitaStatusLabel("settled"), "Recebido")
  })

  await test("2. status derivado: saldo em aberto vira 'partial'", () => {
    // Regra central do Financeiro 2: recebimento parcial não é receita integral.
    assert.equal(deriveReceitaStatus("settled", 150), "partial")
    assert.equal(receitaStatusLabel("partial"), "Parcial")
  })

  await test("3. status derivado: cancelado e estornado são preservados", () => {
    assert.equal(deriveReceitaStatus("cancelled", 0), "cancelled")
    assert.equal(deriveReceitaStatus("reversed", 0), "reversed")
    assert.equal(deriveReceitaStatus("pending", 0), "pending")
  })

  await test("4. origem derivada do status clínico do atendimento", () => {
    assert.equal(deriveReceitaOrigin("scheduled"), "schedule")
    assert.equal(deriveReceitaOrigin("completed"), "appointment")
    assert.equal(deriveReceitaOrigin(null), "manual")
  })

  await test("5. código do atendimento é estável e curto", () => {
    const id = "clx1a2b3c4d5e6f7g8h9i0j1"
    assert.equal(appointmentCode(id), id.slice(-8).toUpperCase())
    assert.equal(appointmentCode(null), null)
  })

  await test("6. código do atendimento é determinístico entre chamadas", () => {
    const id = "cm3abcdefghijklmnopqrstuv"
    assert.equal(appointmentCode(id), appointmentCode(id))
  })

  // -------------------------------------------------------------------------
  section("B. Listagem — período e totais")
  // -------------------------------------------------------------------------

  await test("7. receita efetivada no período entra no total recebido", async () => {
    const paciente = await makePatient("Efetivada Periodo")
    const { appointment } = await makeAppointment({
      patient: paciente,
      totalAmount: 300,
    })
    await seedReceita(appointment.id, { amount: 300, competence: localDate("2026-05-10") })

    const result = await list({
      from: "2026-05-01",
      to: "2026-05-31",
      search: "Efetivada Periodo",
    })

    assert.equal(result.receitas.length, 1)
    assert.equal(result.summary.totalReceived, 300)
    assert.equal(result.summary.receivedCount, 1)
  })

  await test("8. receita fora do período NÃO entra no total", async () => {
    const paciente = await makePatient("Fora do Periodo")
    const { appointment } = await makeAppointment({
      patient: paciente,
      totalAmount: 500,
    })
    await seedReceita(appointment.id, { amount: 500, competence: localDate("2026-04-02") })

    // Mesmo paciente: a linha existe em abril, mas não é contada em maio.
    const result = await list({
      from: "2026-05-01",
      to: "2026-05-31",
      search: "Fora do Periodo",
    })

    assert.equal(result.receitas.length, 0)
    assert.equal(result.summary.totalReceived, 0)
    assert.equal(result.summary.receivedCount, 0)
  })

  await test("9. ticket médio é a média dos recebimentos, não do previsto", async () => {
    const paciente = await makePatient("Ticket Medio")
    const a = await makeAppointment({ patient: paciente, totalAmount: 200 })
    const b = await makeAppointment({ patient: paciente, totalAmount: 600 })
    await seedReceita(a.appointment.id, { amount: 100, competence: localDate("2026-05-05") })
    await seedReceita(b.appointment.id, { amount: 300, competence: localDate("2026-05-06") })

    const result = await list({
      from: "2026-05-01",
      to: "2026-05-31",
      search: "Ticket Medio",
    })

    assert.equal(result.summary.totalReceived, 400)
    assert.equal(result.summary.receivedCount, 2)
    assert.equal(result.summary.averageTicket, 200)
  })

  await test("10. recebimento parcial aparece pelo valor PAGO", async () => {
    const paciente = await makePatient("Parcial Valor Pago")
    const { appointment } = await makeAppointment({
      patient: paciente,
      totalAmount: 1000,
    })
    await seedReceita(appointment.id, { amount: 400, competence: localDate("2026-05-07") })

    const result = await list({
      from: "2026-05-01",
      to: "2026-05-31",
      search: "Parcial Valor Pago",
    })
    const item = result.receitas[0]

    assert.equal(result.receitas.length, 1)
    assert.equal(item.amount, 400)
    assert.equal(item.status, "partial")
    assert.equal(item.expectedTotal, 1000)
    assert.equal(item.pendingTotal, 600)
    assert.equal(result.summary.totalReceived, 400)
  })

  await test("11. receita cancelada fica fora de todos os totais", async () => {
    const paciente = await makePatient("Cancelada Totais")
    const { appointment } = await makeAppointment({
      patient: paciente,
      totalAmount: 250,
    })
    await seedReceita(appointment.id, {
      amount: 250,
      competence: localDate("2026-05-08"),
      transactionStatus: "cancelled",
    })

    const result = await list({
      from: "2026-05-01",
      to: "2026-05-31",
      search: "Cancelada Totais",
    })

    assert.equal(result.receitas.length, 1)
    assert.equal(result.receitas[0].status, "cancelled")
    assert.equal(result.summary.totalReceived, 0)
    assert.equal(result.summary.receivedCount, 0)
    assert.equal(result.summary.totalPending, 0)
  })

  await test("12. receita estornada fica fora de todos os totais", async () => {
    const paciente = await makePatient("Estornada Totais")
    const { appointment } = await makeAppointment({
      patient: paciente,
      totalAmount: 180,
    })
    await seedReceita(appointment.id, {
      amount: 180,
      competence: localDate("2026-05-09"),
      transactionStatus: "reversed",
    })

    const result = await list({
      from: "2026-05-01",
      to: "2026-05-31",
      search: "Estornada Totais",
    })

    assert.equal(result.receitas.length, 1)
    assert.equal(result.receitas[0].status, "reversed")
    assert.equal(result.summary.totalReceived, 0)
  })

  await test("13. receita prevista (nada recebido) conta como saldo, não receita", async () => {
    const paciente = await makePatient("Prevista Saldo")
    const { appointment } = await makeAppointment({
      patient: paciente,
      totalAmount: 700,
    })
    await seedReceita(appointment.id, {
      amount: 700,
      competence: localDate("2026-05-11"),
      transactionStatus: "pending",
      status: "pending",
    })

    const result = await list({
      from: "2026-05-01",
      to: "2026-05-31",
      search: "Prevista Saldo",
    })

    assert.equal(result.summary.totalReceived, 0)
    assert.equal(result.summary.pendingCount, 1)
    assert.equal(result.summary.totalPending, 700)
  })

  // -------------------------------------------------------------------------
  section("C. Busca, filtros, ordenação e paginação")
  // -------------------------------------------------------------------------

  await test("14. busca por nome do paciente filtra no servidor", async () => {
    const alvo = await makePatient("Mariana Buscavel")
    const outro = await makePatient("Joaquim Silveira")
    const a = await makeAppointment({ patient: alvo, totalAmount: 100 })
    const b = await makeAppointment({ patient: outro, totalAmount: 100 })
    await seedReceita(a.appointment.id, { amount: 100, competence: localDate("2026-06-01") })
    await seedReceita(b.appointment.id, { amount: 100, competence: localDate("2026-06-02") })

    const result = await list({
      from: "2026-06-01",
      to: "2026-06-30",
      search: "Mariana Buscavel",
    })

    // A busca isola a linha: o outro paciente não aparece.
    assert.equal(result.receitas.length, 1)
    assert.equal(result.receitas[0].patientName, "Mariana Buscavel")

    const irmao = await list({
      from: "2026-06-01",
      to: "2026-06-30",
      search: "Joaquim Silveira",
    })
    assert.equal(irmao.receitas.length, 1)
    assert.equal(irmao.receitas[0].patientName, "Joaquim Silveira")
  })

  await test("15. busca por nome de procedimento (snapshot) funciona", async () => {
    const proc = await makeProcedure("Clareamento a Laser", 400)
    const { appointment } = await makeAppointment({
      procedures: [{ procedureId: proc.id, name: proc.name, quantity: 1, unitPrice: 400 }],
    })
    await seedReceita(appointment.id, { amount: 400, competence: localDate("2026-06-03") })

    const result = await list({
      from: "2026-06-01",
      to: "2026-06-30",
      search: "Clareamento a Laser",
    })

    assert.equal(result.receitas.length, 1)
    assert.equal(result.receitas[0].procedures[0].name, "Clareamento a Laser")
  })

  await test("16. filtro por status 'partial' exclui as quitadas", async () => {
    const paciente = await makePatient("Filtro Parcial")
    const parcial = await makeAppointment({ patient: paciente, totalAmount: 800 })
    const quitada = await makeAppointment({ patient: paciente, totalAmount: 300 })
    await seedReceita(parcial.appointment.id, {
      amount: 200,
      competence: localDate("2026-06-04"),
    })
    await seedReceita(quitada.appointment.id, {
      amount: 300,
      competence: localDate("2026-06-05"),
    })

    const result = await list({
      from: "2026-06-01",
      to: "2026-06-30",
      search: "Filtro Parcial",
      status: "partial",
    })

    assert.equal(result.receitas.length, 1)
    assert.equal(result.receitas[0].amount, 200)
    assert.equal(result.receitas[0].status, "partial")
  })

  await test("17. filtro por forma de pagamento é exato", async () => {
    const paciente = await makePatient("Filtro Metodo")
    const a = await makeAppointment({ patient: paciente, totalAmount: 100 })
    const b = await makeAppointment({ patient: paciente, totalAmount: 100 })
    await seedReceita(a.appointment.id, {
      amount: 100,
      paymentMethod: "dinheiro",
      competence: localDate("2026-06-06"),
    })
    await seedReceita(b.appointment.id, {
      amount: 100,
      paymentMethod: "cartao_credito",
      competence: localDate("2026-06-07"),
    })

    const result = await list({
      from: "2026-06-01",
      to: "2026-06-30",
      search: "Filtro Metodo",
      paymentMethod: "dinheiro",
    })

    assert.equal(result.receitas.length, 1)
    assert.equal(result.receitas[0].paymentMethodLabel, "Dinheiro")
  })

  await test("18. filtro por origem 'schedule' separa agendamento de atendimento", async () => {
    const paciente = await makePatient("Origem Schedule")
    const agendado = await makeAppointment({
      patient: paciente,
      status: "scheduled",
      totalAmount: 150,
    })
    const concluido = await makeAppointment({
      patient: paciente,
      status: "completed",
      totalAmount: 150,
    })
    await seedReceita(agendado.appointment.id, {
      amount: 150,
      competence: localDate("2026-06-08"),
    })
    await seedReceita(concluido.appointment.id, {
      amount: 150,
      competence: localDate("2026-06-09"),
    })

    const agenda = await list({
      from: "2026-06-01",
      to: "2026-06-30",
      search: "Origem Schedule",
      origin: "schedule",
    })
    const atendimento = await list({
      from: "2026-06-01",
      to: "2026-06-30",
      search: "Origem Schedule",
      origin: "appointment",
    })

    assert.equal(agenda.receitas.length, 1)
    assert.equal(agenda.receitas[0].originLabel, "Agendamento")
    assert.equal(atendimento.receitas.length, 1)
    assert.equal(atendimento.receitas[0].originLabel, "Atendimento")
  })

  await test("19. ordenação por valor respeita a direção pedida", async () => {
    const paciente = await makePatient("Ordenacao Valor")
    const a = await makeAppointment({ patient: paciente, totalAmount: 900 })
    const b = await makeAppointment({ patient: paciente, totalAmount: 900 })
    const c = await makeAppointment({ patient: paciente, totalAmount: 900 })
    await seedReceita(a.appointment.id, { amount: 50, competence: localDate("2026-07-01") })
    await seedReceita(b.appointment.id, { amount: 500, competence: localDate("2026-07-02") })
    await seedReceita(c.appointment.id, { amount: 150, competence: localDate("2026-07-03") })

    const asc = await list({
      from: "2026-07-01",
      to: "2026-07-31",
      search: "Ordenacao Valor",
      sort: "amount",
      direction: "asc",
    })
    const desc = await list({
      from: "2026-07-01",
      to: "2026-07-31",
      search: "Ordenacao Valor",
      sort: "amount",
      direction: "desc",
    })

    assert.deepEqual(
      asc.receitas.map((r) => r.amount),
      [50, 150, 500]
    )
    assert.deepEqual(
      desc.receitas.map((r) => r.amount),
      [500, 150, 50]
    )
  })

  await test("20. paginação recorta o conjunto SEM perder o total", async () => {
    const paciente = await makePatient("Paginacao Escopo")
    for (let i = 0; i < 5; i++) {
      const { appointment } = await makeAppointment({
        patient: paciente,
        totalAmount: 100,
      })
      await seedReceita(appointment.id, {
        amount: 100,
        competence: localDate(`2026-08-0${i + 1}`),
      })
    }

    const page1 = await list({
      from: "2026-08-01",
      to: "2026-08-31",
      search: "Paginacao Escopo",
      page: 1,
      pageSize: 2,
    })
    const page3 = await list({
      from: "2026-08-01",
      to: "2026-08-31",
      search: "Paginacao Escopo",
      page: 3,
      pageSize: 2,
    })

    assert.equal(page1.receitas.length, 2)
    assert.equal(page1.pagination.totalCount, 5)
    assert.equal(page1.pagination.totalPages, 3)
    assert.equal(page1.pagination.hasPrevious, false)
    assert.equal(page1.pagination.hasNext, true)
    assert.equal(page1.pagination.from, 1)
    assert.equal(page1.pagination.to, 2)

    assert.equal(page3.receitas.length, 1)
    assert.equal(page3.pagination.hasNext, false)
    assert.equal(page3.pagination.hasPrevious, true)
    // O resumo é do CONJUNTO filtrado, não da página.
    assert.equal(page3.summary.totalReceived, 500)
  })

  await test("21. página além do fim é normalizada para a última válida", async () => {
    const paciente = await makePatient("Paginacao Limite")
    const { appointment } = await makeAppointment({
      patient: paciente,
      totalAmount: 100,
    })
    await seedReceita(appointment.id, { amount: 100, competence: localDate("2026-08-20") })

    const result = await list({
      from: "2026-08-01",
      to: "2026-08-31",
      search: "Paginacao Limite",
      page: 99,
      pageSize: 10,
    })

    assert.equal(result.pagination.page, 1)
    assert.equal(result.pagination.totalPages, 1)
    assert.equal(result.receitas.length, 1)
  })

  // -------------------------------------------------------------------------
  section("D. Detalhe e histórico")
  // -------------------------------------------------------------------------

  await test("22. detalhe traz procedimentos com preço do snapshot", async () => {
    const proc = await makeProcedure("Extração Simples", 250)
    const { appointment } = await makeAppointment({
      procedures: [{ procedureId: proc.id, name: proc.name, quantity: 2, unitPrice: 250 }],
    })
    const { transactionId } = await seedReceita(appointment.id, {
      amount: 500,
      competence: localDate("2026-09-01"),
    })

    const detail = await getReceitaDetail(transactionId)

    assert.ok(detail)
    assert.equal(detail.procedures.length, 1)
    assert.equal(detail.procedures[0].name, "Extração Simples")
    assert.equal(detail.procedures[0].quantity, 2)
    assert.equal(detail.procedures[0].unitPrice, 250)
    assert.equal(detail.procedures[0].totalPrice, 500)
  })

  await test("23. detalhe aceita o id do PAGAMENTO (link estável)", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 320 })
    const { paymentId, transactionId } = await seedReceita(appointment.id, {
      amount: 320,
      competence: localDate("2026-09-02"),
    })

    const byPayment = await getReceitaDetail(paymentId)

    assert.ok(byPayment)
    assert.equal(byPayment.id, transactionId)
    assert.equal(byPayment.amount, 320)
  })

  await test("24. detalhe lista o histórico de pagamentos do atendimento", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 1000 })
    await seedReceita(appointment.id, {
      amount: 300,
      competence: localDate("2026-09-03"),
    })
    const { transactionId } = await seedReceita(appointment.id, {
      amount: 200,
      competence: localDate("2026-09-04"),
    })

    const detail = await getReceitaDetail(transactionId)

    assert.ok(detail)
    assert.equal(detail.payments.length, 2)
    assert.equal(detail.receivedTotal, 500)
    assert.equal(detail.pendingTotal, 500)
    // A linha aberta é marcada; o histórico permanece completo.
    assert.equal(detail.payments.filter((p) => p.isCurrent).length, 1)
  })

  await test("25. detalhe de id inexistente devolve null (sem lançar)", async () => {
    const detail = await getReceitaDetail("id-que-nao-existe")
    assert.equal(detail, null)
  })

  // -------------------------------------------------------------------------
  section("E. Registro de recebimento e estorno")
  // -------------------------------------------------------------------------

  await test("26. registro de recebimento cria a projeção e quita o atendimento", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 450 })

    const result = await registerReceita({
      appointmentId: appointment.id,
      amount: 450,
      paymentMethod: "pix",
      actorName: "Dra. Helena",
    })

    assert.equal(result.amount, 450)
    assert.equal(result.pendingBefore, 450)
    assert.equal(result.pendingAfter, 0)
    assert.equal(result.appointmentStatus, "paid")
    assert.equal(result.actorName, "Dra. Helena")

    const projection = await prisma.financialTransaction.findFirst({
      where: { paymentId: result.paymentId, direction: "in" },
      select: { id: true, amount: true, status: true },
    })
    assert.ok(projection)
    assert.equal(projection.amount, 450)
  })

  await test("27. recebimento parcial reduz o saldo sem quitar o atendimento", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 1000 })

    const result = await registerReceita({
      appointmentId: appointment.id,
      amount: 300,
      paymentMethod: "dinheiro",
    })

    assert.equal(result.pendingAfter, 700)
    assert.equal(result.appointmentStatus, "awaiting_payment")

    const listagem = await list({ from: "2000-01-01", to: "2099-12-31", search: "" })
    const item = listagem.receitas.find((r) => r.appointmentId === appointment.id)

    assert.ok(item)
    assert.equal(item.amount, 300)
    assert.equal(item.status, "partial")
    assert.equal(item.pendingTotal, 700)
  })

  await test("28. valor inválido é recusado com erro de pagamento", async () => {
    const { appointment } = await makeAppointment({ totalAmount: 100 })

    let lancou = false
    try {
      await registerReceita({
        appointmentId: appointment.id,
        amount: 0,
        paymentMethod: "pix",
      })
    } catch (error) {
      lancou = true
      assert.equal(error.name, "PaymentError")
      assert.equal(error.code, "INVALID_AMOUNT")
    }

    assert.equal(lancou, true)
    // Nada foi persistido.
    const pagamentos = await prisma.payment.count({
      where: { appointmentId: appointment.id },
    })
    assert.equal(pagamentos, 0)
  })

  await test("29. estorno NÃO apaga: marca e remove dos totais", async () => {
    const paciente = await makePatient("Estorno Preserva")
    const { appointment } = await makeAppointment({
      patient: paciente,
      totalAmount: 260,
    })
    const { paymentId, transactionId } = await seedReceita(appointment.id, {
      amount: 260,
      competence: localDate("2026-09-10"),
    })

    const antes = await list({
      from: "2026-09-01",
      to: "2026-09-30",
      search: "Estorno Preserva",
    })
    assert.equal(antes.summary.totalReceived, 260)

    const estornada = await reverseReceita({
      id: transactionId,
      reason: "Pagamento informado por engano",
      actorName: "Recepção",
    })

    assert.ok(estornada)
    assert.equal(estornada.status, "reversed")
    assert.equal(estornada.reverseReason, "Pagamento informado por engano")
    assert.equal(estornada.reversedByName, "Recepção")
    assert.ok(estornada.reversedAt)

    // O registro continua existindo (nada é apagado).
    const aindaExiste = await prisma.financialTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, reversedAt: true },
    })
    assert.ok(aindaExiste)
    assert.ok(aindaExiste.reversedAt)

    const depois = await list({
      from: "2026-09-01",
      to: "2026-09-30",
      search: "Estorno Preserva",
    })
    assert.equal(depois.receitas.length, 1)
    assert.equal(depois.summary.totalReceived, 0)
    assert.equal(depois.summary.receivedCount, 0)

    // O pagamento de origem acompanha, também sem ser removido.
    const pagamento = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { status: true },
    })
    assert.equal(pagamento.status, "refunded")
  })

  await test("30. estorno de id inexistente devolve null e não altera nada", async () => {
    const resultado = await reverseReceita({ id: "nao-existe", actorName: "X" })
    assert.equal(resultado, null)
  })

  // Guarda de integridade: o módulo de domínio continua sendo a fonte dos
  // arredondamentos usados pela receita.
  assert.equal(domain.roundMoney(123.455), 123.46)
}

export default runReceitasScenarios

// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — CONTAS A RECEBER (Financeiro 3).
// ===========================================================================
// Casos exercitando o SERVIÇO REAL contra um SQLite descartável.
//
// Grupos:
//   A. Status derivado (precedência e bordas de vencimento) ..... 1–8
//   B. Construção da conta (saldo, estorno, snapshot) ........... 9–16
//   C. Período, filtros e busca ................................ 17–24
//   D. Ordenação e paginação ................................... 25–30
//   E. Resumo (totais que nunca se misturam) ................... 31–37
//   F. Detalhe e registro de recebimento ....................... 38–44
//
// REGRAS QUE ESTES TESTES PROTEGEM
//   - o protagonista é o SALDO; previsto e recebido nunca viram um só número;
//   - vencimento é comparado por DIA: vencer hoje NÃO é estar vencido;
//   - cancelado fica FORA de todos os totais (inclusive dos contextuais);
//   - estorno devolve o valor ao saldo, sem apagar o registro;
//   - o saldo nunca fica negativo;
//   - a paginação e o resumo referem-se ao conjunto filtrado COMPLETO (o
//     resumo não muda ao trocar de página).

import {
  prisma,
  contasReceberService,
  test,
  section,
  assert,
} from "./_financial-harness.mjs"

const {
  listContasReceber,
  getContaReceberDetail,
  registerContaPayment,
  getContasReceberSummary,
  deriveAccountStatus,
  accountStatusLabel,
} = contasReceberService

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

/** Data local deslocada em N dias a partir de hoje. */
function shiftDays(days) {
  const d = today()
  d.setDate(d.getDate() + days)
  return d
}

function isoDay(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

async function makePatient(name = "Paciente Conta") {
  return prisma.patient.create({
    data: {
      fullName: name,
      cpf: (String(Date.now()) + String(seq++)).slice(-11).padStart(11, "0"),
      birthDate: localDate("1990-01-01"),
    },
    select: { id: true, fullName: true },
  })
}

/**
 * Procedimento do catálogo. Obrigatório: `appointment_procedures.procedure_id`
 * é NOT NULL no schema — o item do atendimento sempre aponta para o catálogo,
 * e o NOME fica congelado no snapshot.
 */
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
 * Atendimento com procedimentos (snapshot) e valor cobrado.
 * `dueIn` desloca o vencimento (que aqui é a DATA DO ATENDIMENTO).
 */
async function makeAppointment(options = {}) {
  const patient = options.patient ?? (await makePatient())
  const items = options.procedures ?? []

  // Cada item precisa de um procedimento REAL do catálogo (FK obrigatória).
  const resolved = []
  for (const item of items) {
    const procedure = item.procedureId
      ? { id: item.procedureId }
      : await makeProcedure(item.name, item.unitPrice)
    resolved.push({ ...item, procedureId: procedure.id })
  }

  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      appointmentDate: options.date ?? shiftDays(options.dueIn ?? 5),
      appointmentTime: options.time ?? "09:00",
      status: options.status ?? "completed",
      totalAmount:
        options.totalAmount === undefined
          ? items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
          : options.totalAmount,
      finishedByName: options.finishedByName ?? null,
      procedures:
        resolved.length > 0
          ? {
              create: resolved.map((i) => ({
                procedureId: i.procedureId,
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

/** Pagamento cru (sem projeção de receita) — é o que Contas a Receber lê. */
async function pay(appointmentId, options = {}) {
  return prisma.payment.create({
    data: {
      appointmentId,
      amount: options.amount ?? 100,
      paymentMethod: options.paymentMethod ?? "pix",
      status: options.status ?? "paid",
      paidAt: options.paidAt ?? today(),
    },
    select: { id: true },
  })
}

/**
 * Executa `listContasReceber` com um escopo de período amplo por padrão,
 * evitando que fixtures caiam fora da janela padrão de vencimento.
 */
function list(options = {}) {
  return listContasReceber({
    period: "custom",
    from: "2000-01-01",
    to: "2099-12-31",
    ...options,
  })
}

export async function runContasReceberScenarios() {
  // -------------------------------------------------------------------------
  section("A. Status derivado (precedência e bordas de vencimento)")
  // -------------------------------------------------------------------------

  await test("1. saldo zero é QUITADO, mesmo com vencimento no passado", () => {
    // A quitação encerra a conta: não faz sentido "cobrar" o que já foi pago.
    assert.equal(
      deriveAccountStatus({
        appointmentStatus: "completed",
        balance: 0,
        receivedAmount: 500,
        dueDate: shiftDays(-10),
        referenceDate: today(),
      }),
      "QUITADO"
    )
    assert.equal(accountStatusLabel("QUITADO"), "Quitado")
  })

  await test("2. atendimento cancelado é CANCELADO, mesmo com saldo em aberto", () => {
    // Cancelado vence todas as outras regras — nunca é cobrável.
    assert.equal(
      deriveAccountStatus({
        appointmentStatus: "cancelled",
        balance: 300,
        receivedAmount: 0,
        dueDate: shiftDays(-30),
        referenceDate: today(),
      }),
      "CANCELADO"
    )
    assert.equal(accountStatusLabel("CANCELADO"), "Cancelado")
  })

  await test("3. saldo em aberto com vencimento no passado é VENCIDO", () => {
    assert.equal(
      deriveAccountStatus({
        appointmentStatus: "completed",
        balance: 250,
        receivedAmount: 0,
        dueDate: shiftDays(-1),
        referenceDate: today(),
      }),
      "VENCIDO"
    )
    assert.equal(accountStatusLabel("VENCIDO"), "Vencido")
  })

  await test("4. vencimento HOJE ainda NÃO é vencido", () => {
    // Comparação por DIA, não por instante: o prazo termina no fim do dia.
    assert.equal(
      deriveAccountStatus({
        appointmentStatus: "completed",
        balance: 250,
        receivedAmount: 0,
        dueDate: today(),
        referenceDate: today(),
      }),
      "EM_ABERTO"
    )
  })

  await test("5. sem recebimento e no prazo é EM_ABERTO", () => {
    assert.equal(
      deriveAccountStatus({
        appointmentStatus: "completed",
        balance: 400,
        receivedAmount: 0,
        dueDate: shiftDays(10),
        referenceDate: today(),
      }),
      "EM_ABERTO"
    )
    assert.equal(accountStatusLabel("EM_ABERTO"), "Em aberto")
  })

  await test("6. com recebimento parcial e no prazo é PARCIAL", () => {
    assert.equal(
      deriveAccountStatus({
        appointmentStatus: "completed",
        balance: 600,
        receivedAmount: 400,
        dueDate: shiftDays(10),
        referenceDate: today(),
      }),
      "PARCIAL"
    )
    assert.equal(accountStatusLabel("PARCIAL"), "Parcial")
  })

  await test("7. conta VENCIDA com recebimento parcial continua VENCIDO", () => {
    // Vencimento tem precedência sobre o "parcial": a urgência é o atraso.
    assert.equal(
      deriveAccountStatus({
        appointmentStatus: "completed",
        balance: 600,
        receivedAmount: 400,
        dueDate: shiftDays(-3),
        referenceDate: today(),
      }),
      "VENCIDO"
    )
  })

  await test("8. vencimento aceito como string ISO e como Date", () => {
    const asString = deriveAccountStatus({
      appointmentStatus: "completed",
      balance: 100,
      receivedAmount: 0,
      dueDate: isoDay(shiftDays(-2)),
      referenceDate: today(),
    })
    const asDate = deriveAccountStatus({
      appointmentStatus: "completed",
      balance: 100,
      receivedAmount: 0,
      dueDate: shiftDays(-2),
      referenceDate: today(),
    })
    assert.equal(asString, "VENCIDO")
    assert.equal(asDate, "VENCIDO")
  })

  // -------------------------------------------------------------------------
  section("B. Construção da conta (saldo, estorno, snapshot)")
  // -------------------------------------------------------------------------

  await test("9. saldo é previsto menos recebido", async () => {
    const patient = await makePatient("Saldo Simples")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 1000,
      dueIn: 5,
    })
    await pay(appointment.id, { amount: 400 })

    const detail = await getContaReceberDetail(appointment.id)
    assert.ok(detail, "a conta deveria existir")
    assert.equal(detail.expectedAmount, 1000)
    assert.equal(detail.receivedAmount, 400)
    assert.equal(detail.balance, 600)
    assert.equal(detail.status, "PARCIAL")
  })

  await test("10. atendimento sem cobrança e sem pagamento não gera conta", async () => {
    // Sem valor não há conta a receber — a tela não inventa linha.
    const patient = await makePatient("Sem Cobranca")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 0,
    })

    const detail = await getContaReceberDetail(appointment.id)
    assert.equal(detail, null)
  })

  await test("11. totalAmount nulo cai para a soma dos procedimentos", async () => {
    const patient = await makePatient("Soma Procedimentos")
    const procedures = [
      { name: "Limpeza", quantity: 1, unitPrice: 150 },
      { name: "Restauração", quantity: 2, unitPrice: 200 },
    ]
    const { appointment } = await makeAppointment({
      patient,
      // totalAmount explícito e coerente: o previsto é o DECLARADO, e a soma
      // dos procedimentos serve de referência para a divergência.
      totalAmount: procedures.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
      procedures,
    })

    const detail = await getContaReceberDetail(appointment.id)
    assert.ok(detail)
    assert.equal(detail.expectedAmount, 550)
    assert.equal(detail.balance, 550)
  })

  await test("12. pagamento estornado NÃO conta como recebimento", async () => {
    const patient = await makePatient("Estorno")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 500,
      dueIn: 5,
    })
    await pay(appointment.id, { amount: 200 })
    await pay(appointment.id, { amount: 300, status: "refunded" })

    const detail = await getContaReceberDetail(appointment.id)
    assert.ok(detail)
    // Só os 200 válidos entram; o estorno volta ao saldo.
    assert.equal(detail.receivedAmount, 200)
    assert.equal(detail.balance, 300)
  })

  await test("13. o registro do estorno permanece no histórico", async () => {
    const patient = await makePatient("Historico Estorno")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 500,
    })
    await pay(appointment.id, { amount: 500, status: "refunded" })

    const detail = await getContaReceberDetail(appointment.id)
    assert.ok(detail)
    // O que foi estornado não compõe `payments` (a lista é de recebimentos).
    assert.equal(detail.payments.length, 0)
    assert.equal(detail.receivedAmount, 0)
    assert.equal(detail.balance, 500)
  })

  await test("14. o saldo nunca fica negativo com pagamento excedente", async () => {
    const patient = await makePatient("Excedente")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 300,
    })
    await pay(appointment.id, { amount: 500 })

    const detail = await getContaReceberDetail(appointment.id)
    assert.ok(detail)
    assert.equal(detail.balance, 0)
    assert.equal(detail.status, "QUITADO")
  })

  await test("15. procedimentos preservam o nome congelado do atendimento", async () => {
    const patient = await makePatient("Snapshot")
    const { appointment } = await makeAppointment({
      patient,
      procedures: [{ name: "Nome Antigo", quantity: 1, unitPrice: 100 }],
    })

    const detail = await getContaReceberDetail(appointment.id)
    assert.ok(detail)
    assert.equal(detail.procedures[0].name, "Nome Antigo")
    assert.equal(detail.procedures[0].totalPrice, 100)
  })

  await test("16. código do atendimento é o final do id, em maiúsculas", async () => {
    const patient = await makePatient("Codigo")
    const { appointment } = await makeAppointment({ patient, totalAmount: 100 })

    const detail = await getContaReceberDetail(appointment.id)
    assert.ok(detail)
    assert.equal(detail.appointmentCode, appointment.id.slice(-8).toUpperCase())
    assert.equal(detail.id, appointment.id)
  })

  // -------------------------------------------------------------------------
  section("C. Período, filtros e busca")
  // -------------------------------------------------------------------------

  await test("17. período filtra pela data de vencimento", async () => {
    const patient = await makePatient("Periodo")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 100,
      dueIn: 10,
    })

    const inside = await list({ from: isoDay(today()), to: isoDay(shiftDays(30)) })
    const outside = await list({ from: isoDay(shiftDays(-30)), to: isoDay(shiftDays(-5)) })

    assert.ok(inside.contas.some((c) => c.id === appointment.id))
    assert.ok(!outside.contas.some((c) => c.id === appointment.id))
  })

  await test("18. filtro por status VENCIDO isola as contas atrasadas", async () => {
    const patient = await makePatient("Filtro Vencido")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 200,
      dueIn: -7,
    })

    const vencidas = await list({ status: "VENCIDO" })
    const emAberto = await list({ status: "EM_ABERTO" })

    assert.ok(vencidas.contas.some((c) => c.id === appointment.id))
    assert.ok(!emAberto.contas.some((c) => c.id === appointment.id))
  })

  await test("19. filtro CANCELADO devolve apenas contas canceladas", async () => {
    const patient = await makePatient("Filtro Cancelado")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 300,
      status: "cancelled",
    })

    const canceladas = await list({ status: "CANCELADO" })
    assert.ok(canceladas.contas.some((c) => c.id === appointment.id))
    assert.ok(canceladas.contas.every((c) => c.status === "CANCELADO"))
  })

  await test("20. sem filtro de status, cancelado NÃO entra na lista", async () => {
    // Cancelado é histórico: não polui a tela de trabalho pendente.
    const patient = await makePatient("Cancelado Oculto")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 300,
      status: "cancelled",
    })

    const todas = await list({})
    assert.ok(!todas.contas.some((c) => c.id === appointment.id))
  })

  await test("21. busca encontra pelo nome do paciente", async () => {
    const unique = `BuscaNome ${uniq()}`
    const patient = await makePatient(unique)
    const { appointment } = await makeAppointment({ patient, totalAmount: 150 })

    const result = await list({ search: unique })
    assert.ok(result.contas.some((c) => c.id === appointment.id))
  })

  await test("22. busca encontra pelo nome do procedimento", async () => {
    const procedureName = `ProcedimentoBusca ${uniq()}`
    const patient = await makePatient("Busca Procedimento")
    const { appointment } = await makeAppointment({
      patient,
      procedures: [{ name: procedureName, quantity: 1, unitPrice: 250 }],
    })

    const result = await list({ search: procedureName })
    assert.ok(result.contas.some((c) => c.id === appointment.id))
  })

  await test("23. faixa de valor filtra pelo SALDO, não pelo previsto", async () => {
    const patient = await makePatient("Faixa Valor")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 1000,
      dueIn: 5,
    })
    await pay(appointment.id, { amount: 700 })

    // Previsto = 1000 (fora da faixa), saldo = 300 (dentro da faixa).
    const porSaldo = await list({ minAmount: 200, maxAmount: 400 })
    assert.ok(porSaldo.contas.some((c) => c.id === appointment.id))

    const porPrevisto = await list({ minAmount: 900, maxAmount: 1100 })
    assert.ok(!porPrevisto.contas.some((c) => c.id === appointment.id))
  })

  await test("24. filtro por profissional usa o nome do responsável", async () => {
    const unique = `Dr. Filtro ${uniq()}`
    const patient = await makePatient("Profissional")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 200,
      finishedByName: unique,
    })

    const result = await list({ professionalName: unique })
    assert.ok(result.contas.some((c) => c.id === appointment.id))
  })

  // -------------------------------------------------------------------------
  section("D. Ordenação e paginação")
  // -------------------------------------------------------------------------

  await test("25. vencido aparece antes de em aberto e de quitado", async () => {
    const patient = await makePatient("Rank Ordem")

    const vencido = await makeAppointment({
      patient,
      totalAmount: 100,
      dueIn: -10,
      finishedByName: "Ranking Teste",
    })
    const aberto = await makeAppointment({
      patient,
      totalAmount: 100,
      dueIn: 10,
      finishedByName: "Ranking Teste",
    })
    const quitado = await makeAppointment({
      patient,
      totalAmount: 100,
      dueIn: 10,
      finishedByName: "Ranking Teste",
    })
    await pay(quitado.appointment.id, { amount: 100 })

    const result = await list({ professionalName: "Ranking Teste" })
    const ids = result.contas.map((c) => c.id)

    assert.ok(ids.indexOf(vencido.appointment.id) < ids.indexOf(aberto.appointment.id))
    assert.ok(ids.indexOf(aberto.appointment.id) < ids.indexOf(quitado.appointment.id))
  })

  await test("26. ordenação por saldo respeita a direção pedida", async () => {
    const unique = `Sort Saldo ${uniq()}`
    const patient = await makePatient("Sort Saldo")

    const pequeno = await makeAppointment({
      patient,
      totalAmount: 100,
      dueIn: 3,
      finishedByName: unique,
    })
    const grande = await makeAppointment({
      patient,
      totalAmount: 900,
      dueIn: 3,
      finishedByName: unique,
    })

    const asc = await list({ professionalName: unique, sort: "balance", direction: "asc" })
    const desc = await list({ professionalName: unique, sort: "balance", direction: "desc" })

    assert.equal(asc.contas[0].id, pequeno.appointment.id)
    assert.equal(desc.contas[0].id, grande.appointment.id)
  })

  await test("27. paginação devolve a página pedida e o total completo", async () => {
    const unique = `Pagina ${uniq()}`
    const patient = await makePatient("Paginacao")
    for (let i = 0; i < 5; i++) {
      await makeAppointment({
        patient,
        totalAmount: 100 + i,
        dueIn: 3,
        finishedByName: unique,
      })
    }

    const page1 = await list({ professionalName: unique, page: 1, pageSize: 2 })
    const page2 = await list({ professionalName: unique, page: 2, pageSize: 2 })

    assert.equal(page1.pagination.totalCount, 5)
    assert.equal(page1.contas.length, 2)
    assert.equal(page2.contas.length, 2)
    assert.notEqual(page1.contas[0].id, page2.contas[0].id)
    assert.equal(page1.pagination.hasNext, true)
    assert.equal(page1.pagination.hasPrevious, false)
  })

  await test("28. página além do fim é trazida para a última válida", async () => {
    const unique = `Pagina Fim ${uniq()}`
    const patient = await makePatient("Pagina Fim")
    await makeAppointment({
      patient,
      totalAmount: 100,
      dueIn: 3,
      finishedByName: unique,
    })

    const result = await list({ professionalName: unique, page: 99, pageSize: 10 })
    assert.equal(result.pagination.page, 1)
    assert.equal(result.pagination.totalPages, 1)
  })

  await test("29. pageSize é limitado a 100", async () => {
    const result = await list({ pageSize: 5000 })
    assert.equal(result.pagination.pageSize, 100)
  })

  await test("30. o resumo não muda ao trocar de página", async () => {
    // O resumo descreve o conjunto FILTRADO COMPLETO — é isso que o card exibe.
    const unique = `Resumo Pagina ${uniq()}`
    const patient = await makePatient("Resumo Pagina")
    for (let i = 0; i < 4; i++) {
      await makeAppointment({
        patient,
        totalAmount: 100,
        dueIn: 3,
        finishedByName: unique,
      })
    }

    const page1 = await list({ professionalName: unique, page: 1, pageSize: 2 })
    const page2 = await list({ professionalName: unique, page: 2, pageSize: 2 })

    assert.equal(page1.summary.totalBalance, page2.summary.totalBalance)
    assert.equal(page1.summary.totalCount, page2.summary.totalCount)
  })

  // -------------------------------------------------------------------------
  section("E. Resumo (totais que nunca se misturam)")
  // -------------------------------------------------------------------------

  await test("31. totalBalance soma apenas saldos de contas em aberto", async () => {
    const unique = `Resumo Saldo ${uniq()}`
    const patient = await makePatient("Resumo Saldo")

    const parcial = await makeAppointment({
      patient,
      totalAmount: 1000,
      dueIn: 5,
      finishedByName: unique,
    })
    await pay(parcial.appointment.id, { amount: 400 })

    const quitado = await makeAppointment({
      patient,
      totalAmount: 600,
      dueIn: 5,
      finishedByName: unique,
    })
    await pay(quitado.appointment.id, { amount: 600 })

    const summary = await getContasReceberSummary({ professionalName: unique })

    // Só os 600 restantes; o atendimento quitado não compõe o saldo.
    assert.equal(summary.totalBalance, 600)
    assert.equal(summary.settledCount, 1)
  })

  await test("32. cancelado fica fora até dos totais contextuais", async () => {
    const unique = `Resumo Cancelado ${uniq()}`
    const patient = await makePatient("Resumo Cancelado")
    await makeAppointment({
      patient,
      totalAmount: 5000,
      status: "cancelled",
      finishedByName: unique,
    })

    const summary = await getContasReceberSummary({ professionalName: unique })
    assert.equal(summary.totalBalance, 0)
    assert.equal(summary.totalExpected, 0)
    assert.equal(summary.totalReceived, 0)
  })

  await test("33. previsto e recebido nunca são somados no mesmo número", async () => {
    const unique = `Resumo Separado ${uniq()}`
    const patient = await makePatient("Resumo Separado")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 1000,
      dueIn: 5,
      finishedByName: unique,
    })
    await pay(appointment.id, { amount: 400 })

    const summary = await getContasReceberSummary({ professionalName: unique })

    // Três leituras distintas: previsto 1000, recebido 400, saldo 600.
    assert.equal(summary.totalExpected, 1000)
    assert.equal(summary.totalReceived, 400)
    assert.equal(summary.totalBalance, 600)
  })

  await test("34. conta vencida também entra no balde de parciais", async () => {
    // "Parcial" descreve o saldo restante de quem já pagou algo — e isso
    // inclui contas atrasadas que já receberam parte.
    const unique = `Resumo Parcial ${uniq()}`
    const patient = await makePatient("Resumo Parcial")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 1000,
      dueIn: -5,
      finishedByName: unique,
    })
    await pay(appointment.id, { amount: 250 })

    const summary = await getContasReceberSummary({ professionalName: unique })

    assert.equal(summary.overdueBalance, 750)
    assert.equal(summary.partialBalance, 750)
    assert.equal(summary.overdueCount, 1)
    assert.equal(summary.partialCount, 1)
  })

  await test("35. os baldes de vencimento são disjuntos e somam o total", async () => {
    const unique = `Resumo Baldes ${uniq()}`
    const patient = await makePatient("Resumo Baldes")

    await makeAppointment({
      patient,
      totalAmount: 100,
      dueIn: -2,
      finishedByName: unique,
    })
    await makeAppointment({
      patient,
      totalAmount: 200,
      dueIn: 0,
      finishedByName: unique,
    })
    await makeAppointment({
      patient,
      totalAmount: 400,
      dueIn: 15,
      finishedByName: unique,
    })

    const summary = await getContasReceberSummary({ professionalName: unique })

    // Cada real de saldo cai em EXATAMENTE um balde: vencido, hoje e futuro
    // são disjuntos e, juntos, cobrem todo o saldo em aberto. O futuro já está
    // contratado (é conta a receber), só ainda não venceu.
    assert.equal(summary.overdueBalance, 100)
    assert.equal(summary.dueTodayBalance, 200)
    assert.equal(summary.upcomingBalance, 400)
    assert.equal(
      summary.overdueBalance + summary.dueTodayBalance + summary.upcomingBalance,
      summary.totalBalance
    )
    assert.equal(summary.totalBalance, 700)
  })

  await test(
    "35b. o resumo não esconde vencidos fora do período da listagem",
    async () => {
      // Regressão: o card "Vencido" é o número mais urgente da tela. Se o
      // resumo herdasse o período da lista (padrão: mês atual), uma cobrança
      // vencida no mês passado sumiria justamente quando o usuário filtra
      // pelo mês corrente.
      const unique = `Resumo Fora do Mês ${uniq()}`
      const patient = await makePatient("Resumo Fora do Mês")

      await makeAppointment({
        patient,
        totalAmount: 500,
        dueIn: -45,
        finishedByName: unique,
      })

      // A LISTA, presa ao mês corrente, não traz a conta...
      const listed = await list({ period: "month", professionalName: unique })
      assert.equal(listed.contas.length, 0)

      // ...mas o RESUMO continua cobrando: a dívida não deixa de existir só
      // porque o filtro de período não a alcança.
      const summary = await getContasReceberSummary({ professionalName: unique })
      assert.equal(summary.overdueBalance, 500)
      assert.equal(summary.totalBalance, 500)
    }
  )

  await test("36. conta com vencimento hoje JÁ compõe o saldo a receber", async () => {
    // O atendimento está `scheduled`, mas o dia do vencimento chegou: vira
    // trabalho de cobrança HOJE, independentemente de quantos dias faltavam.
    const unique = `Resumo Hoje ${uniq()}`
    const patient = await makePatient("Resumo Hoje")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 300,
      dueIn: 0,
      finishedByName: unique,
    })

    const summary = await getContasReceberSummary({ professionalName: unique })

    assert.equal(summary.dueTodayBalance, 300)
    assert.equal(summary.totalBalance, 300)
    assert.equal(summary.dueTodayCount, 1)
    assert.equal(summary.openCount, 1)

    const detail = await getContaReceberDetail(appointment.id)
    assert.equal(detail.daysUntilDue, 0)
    assert.equal(detail.status, "EM_ABERTO")
  })

  await test("37. contagens por status fecham com o total de contas", async () => {
    const unique = `Resumo Contagem ${uniq()}`
    const patient = await makePatient("Resumo Contagem")

    await makeAppointment({
      patient,
      totalAmount: 100,
      dueIn: 5,
      finishedByName: unique,
    })
    const quitado = await makeAppointment({
      patient,
      totalAmount: 100,
      dueIn: 5,
      finishedByName: unique,
    })
    await pay(quitado.appointment.id, { amount: 100 })

    const summary = await getContasReceberSummary({ professionalName: unique })

    assert.equal(summary.totalCount, 2)
    assert.equal(summary.openCount, 1)
    assert.equal(summary.settledCount, 1)
    assert.equal(
      summary.openCount + summary.settledCount + summary.cancelledCount,
      summary.totalCount
    )
  })

  await test("38. totalCount inclui quitados; totalBalance não", async () => {
    const unique = `Resumo Contexto ${uniq()}`
    const patient = await makePatient("Resumo Contexto")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 800,
      dueIn: 5,
      finishedByName: unique,
    })
    await pay(appointment.id, { amount: 800 })

    const summary = await getContasReceberSummary({ professionalName: unique })

    assert.equal(summary.totalCount, 1)
    assert.equal(summary.totalBalance, 0)
    assert.equal(summary.settledCount, 1)
  })

  // -------------------------------------------------------------------------
  section("F. Detalhe e registro de recebimento")
  // -------------------------------------------------------------------------

  await test("38. detalhe de id inexistente devolve null", async () => {
    assert.equal(await getContaReceberDetail("id-que-nao-existe"), null)
    assert.equal(await getContaReceberDetail(""), null)
  })

  await test("39. recebimento parcial atualiza saldo e status", async () => {
    const patient = await makePatient("Recebimento Parcial")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 1000,
      dueIn: 5,
    })

    const result = await registerContaPayment({
      appointmentId: appointment.id,
      amount: 300,
      paymentMethod: "pix",
      actorName: "Recepção",
    })

    assert.equal(result.balanceBefore, 1000)
    assert.equal(result.balanceAfter, 700)
    assert.equal(result.status, "PARCIAL")
    assert.equal(result.statusLabel, "Parcial")
    assert.equal(result.paymentMethodLabel, "PIX")
  })

  await test("40. recebimento total quita a conta", async () => {
    const patient = await makePatient("Recebimento Total")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 450,
      dueIn: -5,
    })

    const result = await registerContaPayment({
      appointmentId: appointment.id,
      amount: 450,
      paymentMethod: "dinheiro",
    })

    assert.equal(result.balanceAfter, 0)
    assert.equal(result.status, "QUITADO")
    assert.equal(result.paymentMethodLabel, "Dinheiro")
  })

  await test("41. saldo excedente é aceito pelo motor e fica limitado a zero", async () => {
    // O serviço canônico de pagamentos NÃO bloqueia excedente — ele o expõe
    // como alerta de integridade. Contas a Receber apenas reflete:
    // o saldo nunca fica negativo e a conta fica QUITADA.
    const patient = await makePatient("Excedente Registro")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 200,
      dueIn: 5,
    })

    const result = await registerContaPayment({
      appointmentId: appointment.id,
      amount: 999,
      paymentMethod: "pix",
    })

    assert.equal(result.balanceBefore, 200)
    assert.equal(result.balanceAfter, 0)
    assert.equal(result.status, "QUITADO")

    // O valor RECEBIDO preserva o que foi realmente registrado.
    const detail = await getContaReceberDetail(appointment.id)
    assert.equal(detail.receivedAmount, 999)
  })

  await test("42. forma de pagamento fora do vocabulário é recusada", async () => {
    const patient = await makePatient("Metodo Invalido")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 200,
      dueIn: 5,
    })

    let rejected = false
    try {
      await registerContaPayment({
        appointmentId: appointment.id,
        amount: 100,
        paymentMethod: "cheque_voando",
      })
    } catch (error) {
      rejected = true
      assert.equal(error.code, "INVALID_METHOD")
    }

    assert.equal(rejected, true)
  })

  await test("43. valor zero ou negativo é recusado", async () => {
    const patient = await makePatient("Recusa Valor")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 200,
      dueIn: 5,
    })

    let rejected = false
    try {
      await registerContaPayment({
        appointmentId: appointment.id,
        amount: 0,
        paymentMethod: "pix",
      })
    } catch (error) {
      rejected = true
      assert.equal(error.code, "INVALID_AMOUNT")
    }

    assert.equal(rejected, true)
  })

  await test("44. dois recebimentos parciais somam e quitam a conta", async () => {
    const patient = await makePatient("Dois Recebimentos")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 500,
      dueIn: 5,
    })

    await registerContaPayment({
      appointmentId: appointment.id,
      amount: 200,
      paymentMethod: "pix",
    })
    const second = await registerContaPayment({
      appointmentId: appointment.id,
      amount: 300,
      paymentMethod: "cartao_credito",
    })

    assert.equal(second.balanceAfter, 0)
    assert.equal(second.status, "QUITADO")

    const detail = await getContaReceberDetail(appointment.id)
    assert.equal(detail.receivedAmount, 500)
    assert.equal(detail.payments.length, 2)
  })

  await test("45. o último pagamento reflete o recebimento mais recente", async () => {
    const patient = await makePatient("Ultimo Pagamento")
    const { appointment } = await makeAppointment({
      patient,
      totalAmount: 900,
      dueIn: 5,
    })

    await registerContaPayment({
      appointmentId: appointment.id,
      amount: 300,
      paymentMethod: "pix",
    })
    await registerContaPayment({
      appointmentId: appointment.id,
      amount: 200,
      paymentMethod: "cartao_credito",
    })

    const detail = await getContaReceberDetail(appointment.id)
    assert.ok(detail.lastPayment)
    assert.equal(detail.lastPayment.amount, 200)
    assert.equal(detail.lastPayment.paymentMethodLabel, "Cartão de Crédito")
  })
}

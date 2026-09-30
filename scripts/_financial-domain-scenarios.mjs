// ===========================================================================
// CENÁRIOS DE TESTE — DOMÍNIO FINANCEIRO (puro, sem banco).
// ===========================================================================
// Verifica as regras que garantem que o Financeiro NÃO mistura conceitos:
// valor previsto x recebido, pendente x excedente, efetivado x cancelado.

import { domain, test, section, assert } from "./_financial-harness.mjs"

export async function runDomainScenarios() {
  const {
    aggregateFlow,
    computeAppointmentValues,
    deriveIncomeFromPayment,
    resolvePeriodRange,
    toMonthKey,
    toDayKey,
    monthKeyLabel,
    roundMoney,
    toCents,
    fromCents,
    sumMoney,
    normalizeAmount,
    paymentMethodLabel,
    isBillableAppointmentStatus,
    isExcludedFromTotals,
    isCashEffective,
    safeText,
  } = domain

  // -------------------------------------------------------------------------
  section("Dinheiro — precisão e arredondamento")
  // -------------------------------------------------------------------------

  await test("soma de centavos não sofre erro de ponto flutuante", () => {
    // 0.1 + 0.2 = 0.30000000000000004 em float puro.
    assert.equal(sumMoney([0.1, 0.2]), 0.3)
    assert.equal(sumMoney([0.1, 0.2, 0.3]), 0.6)
  })

  await test("conversão reais <-> centavos é estável", () => {
    assert.equal(toCents(19.99), 1999)
    assert.equal(fromCents(1999), 19.99)
    assert.equal(toCents(0.1), 10)
  })

  await test("valores não finitos não contaminam o total", () => {
    assert.equal(roundMoney(NaN), 0)
    assert.equal(roundMoney(Infinity), 0)
    assert.equal(toCents(NaN), 0)
  })

  await test("normalizeAmount preserva o sinal (não transforma -50 em 50)", () => {
    // Um valor negativo é erro de entrada, não algo a "corrigir": o sinal é
    // preservado para que a validação a montante rejeite o lançamento.
    assert.equal(normalizeAmount(-50), -50)
    // "-0" e "0" são fisiologicamente iguais; comparamos pelo valor absoluto
    // do zero para não depender da representação interna do IEEE-754.
    assert.ok(Object.is(normalizeAmount(-0.001), 0) || normalizeAmount(-0.001) === -0)
    assert.equal(normalizeAmount("12.345"), 12.35)
    assert.equal(normalizeAmount("abc"), 0)
    assert.equal(normalizeAmount(0), 0)
  })

  // -------------------------------------------------------------------------
  section("Consolidação — recebido ≠ previsto")
  // -------------------------------------------------------------------------

  await test("efetivado compõe recebido/pago; previsto NÃO entra no caixa", () => {
    const totals = aggregateFlow([
      { direction: "in", amount: 100, status: "settled" },
      { direction: "in", amount: 200, status: "pending" },
      { direction: "out", amount: 50, status: "settled" },
      { direction: "out", amount: 30, status: "pending" },
    ])

    // Caixa realizado NÃO inclui os previstos.
    assert.equal(totals.received, 100)
    assert.equal(totals.paid, 50)
    assert.equal(totals.net, 50)

    // Previsões ficam separadas.
    assert.equal(totals.expectedIn, 200)
    assert.equal(totals.expectedOut, 30)
    assert.equal(totals.projectedNet, 220)
  })

  await test("cancelado e estornado ficam fora de TODOS os totais", () => {
    const totals = aggregateFlow([
      { direction: "in", amount: 500, status: "settled" },
      { direction: "in", amount: 999, status: "cancelled" },
      { direction: "in", amount: 777, status: "reversed" },
      { direction: "out", amount: 888, status: "cancelled" },
    ])

    assert.equal(totals.received, 500)
    assert.equal(totals.paid, 0)
    assert.equal(totals.expectedIn, 0)
    assert.equal(totals.expectedOut, 0)
    assert.equal(totals.net, 500)
  })

  await test("lista vazia produz zeros (nunca valor inventado)", () => {
    const totals = aggregateFlow([])
    assert.equal(totals.received, 0)
    assert.equal(totals.paid, 0)
    assert.equal(totals.net, 0)
    assert.equal(totals.projectedNet, 0)
    assert.equal(totals.settledCount, 0)
  })

  await test("contadores distinguem efetivado de pendente", () => {
    const totals = aggregateFlow([
      { direction: "in", amount: 10, status: "settled" },
      { direction: "out", amount: 10, status: "settled" },
      { direction: "in", amount: 10, status: "pending" },
    ])
    assert.equal(totals.settledCount, 2)
    assert.equal(totals.pendingCount, 1)
  })

  await test("classificação de status é consistente", () => {
    assert.equal(isCashEffective("settled"), true)
    assert.equal(isCashEffective("pending"), false)
    assert.equal(isExcludedFromTotals("cancelled"), true)
    assert.equal(isExcludedFromTotals("reversed"), true)
    assert.equal(isExcludedFromTotals("settled"), false)
  })

  // -------------------------------------------------------------------------
  section("Valores do atendimento — previsto, recebido, pendente, excedente")
  // -------------------------------------------------------------------------

  await test("previsto usa total_amount quando declarado", () => {
    const v = computeAppointmentValues({
      totalAmount: 400,
      proceduresTotal: 400,
      paidTotal: 150,
    })
    assert.equal(v.expected, 400)
    assert.equal(v.received, 150)
    assert.equal(v.pending, 250)
    assert.equal(v.overpaid, 0)
    assert.equal(v.declaredVsProceduresDiff, null)
  })

  await test("sem total_amount, a soma dos procedimentos é o previsto", () => {
    const v = computeAppointmentValues({
      totalAmount: null,
      proceduresTotal: 320,
      paidTotal: 320,
    })
    assert.equal(v.expected, 320)
    assert.equal(v.pending, 0)
    assert.equal(v.declaredTotal, null)
  })

  await test("pagamento excedente NÃO reduz pendente de outros atendimentos", () => {
    // Caso real do banco de desenvolvimento: previsto 400, recebido 800.
    const v = computeAppointmentValues({
      totalAmount: 400,
      proceduresTotal: 400,
      paidTotal: 800,
    })
    assert.equal(v.pending, 0, "pendente nunca fica negativo")
    assert.equal(v.overpaid, 400, "excedente é sinalizado separadamente")
    assert.equal(v.received, 800, "recebido permanece o valor real")
  })

  await test("divergência entre total declarado e procedimentos é exposta", () => {
    const v = computeAppointmentValues({
      totalAmount: 500,
      proceduresTotal: 450,
      paidTotal: 0,
    })
    assert.equal(v.declaredVsProceduresDiff, 50)
  })

  await test("valores fracionários não geram pendente fantasma", () => {
    const v = computeAppointmentValues({
      totalAmount: 0.3,
      proceduresTotal: 0.1 + 0.2,
      paidTotal: 0.3,
    })
    assert.equal(v.pending, 0)
    assert.equal(v.overpaid, 0)
  })

  await test("atendimento sem valor previsto não gera pendente", () => {
    const v = computeAppointmentValues({
      totalAmount: null,
      proceduresTotal: 0,
      paidTotal: 0,
    })
    assert.equal(v.expected, 0)
    assert.equal(v.pending, 0)
  })

  // -------------------------------------------------------------------------
  section("Derivação da receita a partir do pagamento")
  // -------------------------------------------------------------------------

  await test("pagamento pago vira movimentação efetivada", () => {
    const paidAt = new Date("2026-03-10T12:00:00Z")
    const d = deriveIncomeFromPayment({
      id: "p1",
      amount: 100,
      status: "paid",
      paidAt,
      createdAt: new Date("2026-03-01T00:00:00Z"),
      paymentMethod: "pix",
      appointmentId: "a1",
    })
    assert.equal(d.status, "settled")
    assert.equal(d.competenceDate.getTime(), paidAt.getTime())
  })

  await test("pagamento pendente vira movimentação prevista", () => {
    const createdAt = new Date("2026-03-01T00:00:00Z")
    const d = deriveIncomeFromPayment({
      id: "p2",
      amount: 100,
      status: "pending",
      paidAt: null,
      createdAt,
      paymentMethod: "pix",
      appointmentId: "a1",
    })
    assert.equal(d.status, "pending")
    assert.equal(d.competenceDate.getTime(), createdAt.getTime())
  })

  await test("pagamento estornado vira movimentação estornada (fora do caixa)", () => {
    const d = deriveIncomeFromPayment({
      id: "p3",
      amount: 100,
      status: "refunded",
      paidAt: new Date("2026-04-01T00:00:00Z"),
      createdAt: new Date("2026-03-01T00:00:00Z"),
      paymentMethod: "pix",
      appointmentId: "a1",
    })
    assert.equal(d.status, "reversed")
    assert.equal(isExcludedFromTotals(d.status), true)
  })

  // -------------------------------------------------------------------------
  section("Períodos do Dashboard")
  // -------------------------------------------------------------------------

  const ref = new Date(2026, 8, 19, 15, 30) // 19/09/2026 15:30 local

  await test("'hoje' cobre exatamente o dia de referência", () => {
    const r = resolvePeriodRange("today", ref)
    assert.equal(r.start.getDate(), 19)
    assert.equal(r.start.getHours(), 0)
    assert.equal(r.end.getDate(), 19)
    assert.equal(r.end.getHours(), 23)
  })

  await test("'7d' inclui o dia de referência e 6 anteriores", () => {
    const r = resolvePeriodRange("7d", ref)
    assert.equal(r.start.getDate(), 13)
    assert.equal(r.end.getDate(), 19)
  })

  await test("'30d' cobre 30 dias incluindo a referência", () => {
    const r = resolvePeriodRange("30d", ref)
    // Contagem em DIAS DE CALENDÁRIO (evita ruído de horário de verão no
    // cálculo por diferença de milissegundos).
    const startDay = new Date(r.start.getFullYear(), r.start.getMonth(), r.start.getDate())
    const endDay = new Date(r.end.getFullYear(), r.end.getMonth(), r.end.getDate())
    const days = Math.round((endDay - startDay) / (24 * 60 * 60 * 1000)) + 1
    assert.equal(days, 30)
    assert.equal(r.end.getDate(), 19, "termina no dia de referência")
    assert.equal(r.start.getDate(), 21, "começa em 21/08 (30 dias até 19/09)")
  })

  await test("'month' cobre o mês inteiro de referência", () => {
    const r = resolvePeriodRange("month", ref)
    assert.equal(r.start.getDate(), 1)
    assert.equal(r.start.getMonth(), 8)
    assert.equal(r.end.getDate(), 30) // setembro tem 30 dias
    assert.equal(r.end.getMonth(), 8)
  })

  await test("'year' cobre de 1º de janeiro a 31 de dezembro", () => {
    const r = resolvePeriodRange("year", ref)
    assert.equal(r.start.getMonth(), 0)
    assert.equal(r.start.getDate(), 1)
    assert.equal(r.end.getMonth(), 11)
    assert.equal(r.end.getDate(), 31)
  })

  await test("intervalo invertido é normalizado (nunca range inválido)", () => {
    const r = resolvePeriodRange("custom", ref, { from: "2026-09-20", to: "2026-09-01" })
    assert.ok(r.start <= r.end, "start deve ser anterior ou igual a end")
    assert.equal(r.start.getDate(), 1)
    assert.equal(r.end.getDate(), 20)
  })

  await test("preset desconhecido cai para o mês (comportamento previsível)", () => {
    const r = resolvePeriodRange("inexistente", ref)
    assert.equal(r.start.getDate(), 1)
  })

  await test("custom sem datas cai para o DIA da referência (fallback seguro)", () => {
    // Sem datas explícitas o intervalo não pode ser inventado: usa-se o dia de
    // referência, que é o menor recorte previsível.
    const r = resolvePeriodRange("custom", ref, {})
    assert.equal(r.start.getDate(), 19)
    assert.equal(r.end.getDate(), 19)
    assert.equal(r.start.getMonth(), 8)
  })

  await test("chaves de dia e mês são estáveis", () => {
    const d = new Date(2026, 8, 5)
    assert.equal(toDayKey(d), "2026-09-05")
    assert.equal(toMonthKey(d), "2026-09")
    assert.equal(monthKeyLabel("2026-09"), "09/2026")
  })

  // -------------------------------------------------------------------------
  section("Apresentação — rótulos sem invenção de dado")
  // -------------------------------------------------------------------------

  await test("forma de pagamento desconhecida cai para o próprio código", () => {
    assert.equal(paymentMethodLabel("pix"), "PIX")
    assert.equal(paymentMethodLabel("cripto"), "cripto")
    assert.equal(paymentMethodLabel(null), "Não informado")
  })

  await test("texto vazio vira marcador, não string inventada", () => {
    assert.equal(safeText("  "), "—")
    assert.equal(safeText(null), "—")
    assert.equal(safeText("Recebimento"), "Recebimento")
  })

  await test("atendimento cancelado/não compareceu não gera conta a receber", () => {
    assert.equal(isBillableAppointmentStatus("completed"), true)
    assert.equal(isBillableAppointmentStatus("paid"), true)
    assert.equal(isBillableAppointmentStatus("cancelled"), false)
    assert.equal(isBillableAppointmentStatus("no_show"), false)
  })
}

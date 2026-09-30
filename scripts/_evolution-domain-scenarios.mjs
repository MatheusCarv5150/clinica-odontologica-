// ===========================================================================
// CENÁRIOS DE DOMÍNIO — EVOLUÇÃO CRONOLÓGICA (Parte 8).
//
// Testam as REGRAS PURAS (sem banco): classificação do item da timeline,
// agrupamento por data, montagem de dentes e formatação. São a base da
// garantia de que a Evolução NÃO confunde categorias (cancelado não é
// evolução clínica, rascunho não é documento finalizado, etc.).
// ===========================================================================

import { domain, test, section, assert } from "./_evolution-harness.mjs"

export async function runDomainScenarios() {
  section("Domínio — classificação da timeline")

  await test("atendimento em andamento é classificado como 'current'", () => {
    const kind = domain.classifyTimelineEntry({
      status: "in_progress",
      hasFinalizedRecord: false,
      hasRecord: false,
      hasClinicalContent: true,
      isCurrent: true,
    })
    assert.equal(kind, "current")
  })

  await test("registro finalizado é 'documented'", () => {
    const kind = domain.classifyTimelineEntry({
      status: "completed",
      hasFinalizedRecord: true,
      hasRecord: true,
      hasClinicalContent: true,
      isCurrent: false,
    })
    assert.equal(kind, "documented")
  })

  await test("registro iniciado e não finalizado é 'draft' (rascunho)", () => {
    const kind = domain.classifyTimelineEntry({
      status: "completed",
      hasFinalizedRecord: false,
      hasRecord: true,
      hasClinicalContent: true,
      isCurrent: false,
    })
    assert.equal(kind, "draft")
  })

  await test("sem registro, mas com procedimentos/eventos é 'incomplete'", () => {
    const kind = domain.classifyTimelineEntry({
      status: "completed",
      hasFinalizedRecord: false,
      hasRecord: false,
      hasClinicalContent: true,
      isCurrent: false,
    })
    assert.equal(kind, "incomplete")
  })

  await test("atendimento concluído sem nenhum conteúdo é 'incomplete'", () => {
    const kind = domain.classifyTimelineEntry({
      status: "completed",
      hasFinalizedRecord: false,
      hasRecord: false,
      hasClinicalContent: false,
      isCurrent: false,
    })
    assert.equal(kind, "incomplete")
  })

  await test("cancelado NÃO é evolução clínica", () => {
    const kind = domain.classifyTimelineEntry({
      status: "cancelled",
      hasFinalizedRecord: false,
      hasRecord: false,
      hasClinicalContent: false,
      isCurrent: false,
    })
    assert.equal(kind, "cancelled")
    assert.equal(domain.isClinicalEntry(kind), false)
  })

  await test("não comparecimento NÃO gera evolução clínica", () => {
    const kind = domain.classifyTimelineEntry({
      status: "no_show",
      hasFinalizedRecord: false,
      hasRecord: false,
      hasClinicalContent: false,
      isCurrent: false,
    })
    assert.equal(kind, "no_show")
    assert.equal(domain.isClinicalEntry(kind), false)
  })

  await test("atendimento apenas agendado não é evolução", () => {
    const kind = domain.classifyTimelineEntry({
      status: "scheduled",
      hasFinalizedRecord: false,
      hasRecord: false,
      hasClinicalContent: false,
      isCurrent: false,
    })
    assert.equal(kind, "scheduled")
    assert.equal(domain.isClinicalEntry(kind), false)
  })

  await test("documentado, rascunho e incompleto SÃO evolução clínica", () => {
    assert.equal(domain.isClinicalEntry("documented"), true)
    assert.equal(domain.isClinicalEntry("draft"), true)
    assert.equal(domain.isClinicalEntry("incomplete"), true)
    assert.equal(domain.isClinicalEntry("current"), true)
  })

  section("Domínio — dentes e superfícies")

  await test("collectTeeth deduplica dentes e ordena numericamente", () => {
    const teeth = domain.collectTeeth(
      [
        { toothNumber: "36", surfaces: ["M"] },
        { toothNumber: "26", surfaces: ["O"] },
        { toothNumber: "26", surfaces: ["M"] },
      ],
      [{ toothNumber: "26", surfaces: ["V"] }],
    )
    assert.deepEqual(
      teeth.map((t) => t.toothNumber),
      ["26", "36"],
    )
  })

  await test("collectTeeth mantém ordem clínica das superfícies (M,D,O,V,L)", () => {
    const teeth = domain.collectTeeth(
      [{ toothNumber: "26", surfaces: ["V", "M", "O"] }],
      [],
    )
    assert.deepEqual(teeth[0].surfaces, ["M", "O", "V"])
  })

  await test("collectTeeth ignora procedimentos sem dente", () => {
    const teeth = domain.collectTeeth(
      [{ toothNumber: null, surfaces: [] }],
      [],
    )
    assert.equal(teeth.length, 0)
  })

  await test("formatSurfaceList traduz código para rótulo clínico", () => {
    assert.equal(domain.formatSurfaceList("M,O"), "Mesial / Oclusal")
    assert.equal(domain.formatSurfaceList(""), "")
  })

  section("Domínio — resumo e datas")

  await test("summarizeEvolutionText corta textos longos sem quebrar palavras", () => {
    const long = "Paciente apresentou excelente tolerância ao procedimento. ".repeat(5)
    const result = domain.summarizeEvolutionText(long, 60)
    assert.ok(result)
    assert.equal(result.truncated, true)
    assert.ok(result.text.length <= 61)
  })

  await test("summarizeEvolutionText devolve null para texto vazio", () => {
    assert.equal(domain.summarizeEvolutionText(null), null)
    assert.equal(domain.summarizeEvolutionText("   "), null)
  })

  await test("formatTimelineCardDate usa o dia em UTC (sem deslocar por fuso)", () => {
    assert.equal(domain.formatTimelineCardDate("2026-09-19T00:00:00.000Z"), "19 SET 2026")
  })

  await test("formatTimelineTime normaliza HH:MM", () => {
    assert.equal(domain.formatTimelineTime("9:05"), "09:05")
    assert.equal(domain.formatTimelineTime(null), null)
  })

  await test("formatTimelineAuditStamp devolve null quando não há registro", () => {
    assert.equal(domain.formatTimelineAuditStamp(null), null)
    assert.ok(domain.formatTimelineAuditStamp("2026-09-19T12:30:00.000Z"))
  })

  section("Domínio — filtros")

  await test("parseTimelineQuery aplica padrões seguros", () => {
    const query = domain.parseTimelineQuery(new URLSearchParams())
    assert.equal(query.period, "all")
    assert.equal(query.sort, "desc")
    assert.equal(query.page, 1)
    assert.equal(query.includeNonClinical, false)
  })

  await test("parseTimelineQuery respeita pageSize máximo de 50", () => {
    const query = domain.parseTimelineQuery(
      new URLSearchParams("pageSize=999"),
    )
    assert.equal(query.pageSize, 50)
  })

  await test("parseTimelineQuery rejeita período inválido (volta para 'all')", () => {
    const query = domain.parseTimelineQuery(
      new URLSearchParams("period=hack"),
    )
    assert.equal(query.period, "all")
  })

  await test("resolvePeriodRange devolve intervalo coerente para 30 dias", () => {
    const range = domain.resolvePeriodRange("30d", new Date("2026-09-19T10:00:00Z"))
    assert.ok(range.from && range.to)
    const days = Math.round(
      (range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000),
    )
    assert.equal(days, 30)
  })

  await test("resolvePeriodRange não restringe 'all' nem 'custom'", () => {
    assert.deepEqual(domain.resolvePeriodRange("all"), {})
    assert.deepEqual(domain.resolvePeriodRange("custom"), {})
  })
}

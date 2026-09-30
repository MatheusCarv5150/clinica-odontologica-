// ===========================================================================
// CENÁRIOS DE DOMÍNIO — PROCEDIMENTOS (Parte 7).
//
// Testes PUROS (sem banco): garantem que as REGRAS DE NEGÓCIO da comparação
// previsto x realizado, das superfícies e da autorização de alteração de
// valor estão corretas antes de qualquer persistência.
//
// Executado por scripts/test-procedures.mjs.
// ===========================================================================

import { domain, catalog, test, section, assert } from "./_procedures-harness.mjs"

export async function runDomainScenarios() {
  section("Domínio — catálogo de dentes (fonte única)")

  await test("o catálogo conhece dentes permanentes e decíduos", () => {
    const permanent = catalog.listTeeth("permanent")
    const deciduous = catalog.listTeeth("deciduous")
    assert.ok(permanent.length > 0, "esperado dentes permanentes")
    assert.ok(deciduous.length > 0, "esperado dentes decíduos")
  })

  await test("a superfície Oclusal vira Incisal em dentes anteriores", () => {
    // Não há um segundo cadastro de dentes: o rótulo vem do catálogo único.
    assert.equal(catalog.getSurfaceLabel("O", "central_incisor"), "Incisal")
    assert.equal(catalog.getSurfaceLabel("O", "first_molar"), "Oclusal")
  })

  await test("superfícies inválidas são descartadas e a ordem é estável", () => {
    const csv = catalog.normalizeSurfaces(["O", "M", "X", "M", "D"])
    assert.equal(csv, "M,D,O")
  })

  section("Domínio — deduplicação de procedimento no mesmo dente")

  await test("mesmo procedimento, mesmo dente e mesma face é duplicado", () => {
    const existing = [
      { procedureId: "p1", toothNumber: "26", surfaces: "M,O", status: "performed" },
    ]
    const dup = domain.findDuplicate(existing, {
      procedureId: "p1",
      toothNumber: "26",
      surfaces: "M,O",
    })
    assert.ok(dup, "deveria detectar duplicidade")
  })

  await test("ordem das faces não muda a chave de duplicidade", () => {
    const existing = [
      { procedureId: "p1", toothNumber: "26", surfaces: "M,O", status: "performed" },
    ]
    const dup = domain.findDuplicate(existing, {
      procedureId: "p1",
      toothNumber: "26",
      surfaces: "O,M",
    })
    assert.ok(dup, "ordem das faces não deveria gerar falso negativo")
  })

  await test("dentes diferentes NÃO são duplicidade", () => {
    const existing = [
      { procedureId: "p1", toothNumber: "26", surfaces: "O", status: "performed" },
    ]
    assert.equal(
      domain.findDuplicate(existing, {
        procedureId: "p1",
        toothNumber: "27",
        surfaces: "O",
      }),
      null
    )
  })

  await test("registro ainda pendente não bloqueia novo registro", () => {
    const existing = [
      { procedureId: "p1", toothNumber: "26", surfaces: "O", status: "pending" },
    ]
    assert.equal(
      domain.findDuplicate(existing, {
        procedureId: "p1",
        toothNumber: "26",
        surfaces: "O",
      }),
      null
    )
  })

  section("Domínio — referência textual do dente")

  await test("sem dente não há referência textual", () => {
    assert.equal(domain.formatToothReference(null, []), null)
  })

  await test("dente sem face exibe apenas o número", () => {
    assert.equal(domain.formatToothReference("26", []), "Dente 26")
  })

  await test("dente com faces exibe número e faces", () => {
    assert.equal(domain.formatToothReference("26", ["M", "O"]), "Dente 26 • M, O")
  })

  section("Domínio — normalização de superfícies do procedimento")

  await test("CSV de superfícies é normalizado (sem duplicatas, ordem clínica)", () => {
    assert.equal(domain.normalizeProcedureSurfaces(["O", "M"]), "M,O")
    assert.equal(domain.normalizeProcedureSurfaces([]), "")
  })

  await test("CSV de superfícies volta como lista", () => {
    assert.deepEqual(domain.procedureSurfacesToList("M,O"), ["M", "O"])
    assert.deepEqual(domain.procedureSurfacesToList(null), [])
    assert.deepEqual(domain.procedureSurfacesToList(""), [])
  })

  section("Domínio — status considerado realizado")

  await test("somente 'performed' conta como realizado", () => {
    assert.equal(domain.isPerformed("performed"), true)
    for (const status of ["pending", "in_progress", "not_performed", "cancelled"]) {
      assert.equal(domain.isPerformed(status), false, `status ${status}`)
    }
  })

  await test("todo status possui metadados de apresentação", () => {
    for (const status of domain.PROCEDURE_EXECUTION_STATUSES) {
      const meta = domain.getProcedureStatusMeta(status)
      assert.ok(meta.label, `label ausente para ${status}`)
    }
  })

  section("Domínio — comparação previsto x realizado")

  await test("item da Agenda realizado é 'realizado conforme previsto'", () => {
    assert.equal(
      domain.compareScheduledVsPerformed({
        isScheduled: true,
        origin: "scheduled",
        status: "performed",
      }),
      "performed_as_planned"
    )
  })

  await test("item previsto marcado como não realizado é 'não realizado'", () => {
    assert.equal(
      domain.compareScheduledVsPerformed({
        isScheduled: true,
        origin: "scheduled",
        status: "not_performed",
      }),
      "not_performed"
    )
  })

  await test("procedimento previsto ainda pendente é 'aguardando'", () => {
    for (const status of ["pending", "in_progress"]) {
      assert.equal(
        domain.compareScheduledVsPerformed({
          isScheduled: true,
          origin: "scheduled",
          status,
        }),
        "pending",
        `status ${status}`
      )
    }
  })

  await test("procedimento adicionado no atendimento e realizado é 'adicionado'", () => {
    assert.equal(
      domain.compareScheduledVsPerformed({
        isScheduled: false,
        origin: "added_in_attendance",
        status: "performed",
      }),
      "added_in_attendance"
    )
  })

  await test("status 'cancelled' tem precedência na comparação", () => {
    assert.equal(
      domain.compareScheduledVsPerformed({
        isScheduled: true,
        origin: "scheduled",
        status: "cancelled",
      }),
      "cancelled"
    )
  })

  await test("meta da comparação cobre todos os resultados possíveis", () => {
    const cases = [
      domain.compareScheduledVsPerformed({ isScheduled: true, origin: "scheduled", status: "performed" }),
      domain.compareScheduledVsPerformed({ isScheduled: true, origin: "scheduled", status: "not_performed" }),
      domain.compareScheduledVsPerformed({ isScheduled: true, origin: "scheduled", status: "pending" }),
      domain.compareScheduledVsPerformed({ isScheduled: false, origin: "added_in_attendance", status: "performed" }),
      domain.compareScheduledVsPerformed({ isScheduled: true, origin: "scheduled", status: "cancelled" }),
    ]
    for (const result of cases) {
      const meta = domain.PROCEDURE_COMPARISON_META[result]
      assert.ok(meta, `sem metadados para ${result}`)
      assert.ok(meta.label, `sem label para ${result}`)
    }
  })

  section("Domínio — comparação de VALORES (previsto x realizado)")

  await test("valores iguais não geram diferença", () => {
    const result = domain.compareValues(250, 250)
    assert.equal(result.isDifferent, false)
    assert.equal(result.difference, 0)
  })

  await test("valores diferentes geram diferença explícita (com sinal)", () => {
    const up = domain.compareValues(250, 300)
    assert.equal(up.isDifferent, true)
    assert.equal(up.difference, 50)

    const down = domain.compareValues(300, 250)
    assert.equal(down.isDifferent, true)
    assert.equal(down.difference, -50)
  })

  await test("centavos não contam como diferença", () => {
    assert.equal(domain.compareValues(100, 100.004).isDifferent, false)
  })

  await test("sem valor realizado não há diferença calculada", () => {
    const result = domain.compareValues(250, null)
    assert.equal(result.isDifferent, false)
    assert.equal(result.difference, null)
  })

  section("Domínio — motivos de não realização")

  await test("todo motivo tem código e rótulo", () => {
    assert.ok(domain.PROCEDURE_REASONS.length > 0)
    for (const reason of domain.PROCEDURE_REASONS) {
      assert.ok(reason.code, "código ausente")
      assert.ok(reason.label, `rótulo ausente para ${reason.code}`)
    }
  })

  await test("rótulo do motivo é resolvido pelo código", () => {
    const first = domain.PROCEDURE_REASONS[0]
    assert.equal(domain.getProcedureReasonLabel(first.code), first.label)
    assert.equal(domain.getProcedureReasonLabel(null), null)
    assert.equal(domain.getProcedureReasonLabel("inexistente"), null)
  })

  await test("origem é rotulada em português", () => {
    assert.ok(domain.PROCEDURE_ORIGIN_LABELS.scheduled)
    assert.ok(domain.PROCEDURE_ORIGIN_LABELS.added_in_attendance)
  })
}

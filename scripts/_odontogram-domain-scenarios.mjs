// ===========================================================================
// Testes de DOMÍNIO do odontograma (Parte 5) — regras puras, sem banco.
//
// Verificam o que GARANTE o comportamento clínico exigido:
// numeração FDI, dentições separadas, superfícies específicas, catálogo de
// condições aplicável, projeção do estado atual e regras de múltipla seleção.
// ===========================================================================

import { assert, catalog, domain, schemas, section, test } from "./_odontogram-harness.mjs"

export async function runDomainScenarios() {
  // -----------------------------------------------------------------------
  section("(1) Numeração FDI / ISO 3950")
  // -----------------------------------------------------------------------

  await test("permanente possui 32 dentes nos quadrantes 1-4", () => {
    const teeth = catalog.listTeeth("permanent")
    assert.equal(teeth.length, 32)
    const quadrants = new Set(teeth.map((t) => t.quadrant))
    assert.deepEqual([...quadrants].sort(), [1, 2, 3, 4])
  })

  await test("decídua possui 20 dentes nos quadrantes 5-8", () => {
    const teeth = catalog.listTeeth("deciduous")
    assert.equal(teeth.length, 20)
    const quadrants = new Set(teeth.map((t) => t.quadrant))
    assert.deepEqual([...quadrants].sort(), [5, 6, 7, 8])
  })

  await test("números FDI corretos (11..18, 21..28, 31..38, 41..48)", () => {
    const numbers = new Set(catalog.listTeeth("permanent").map((t) => t.number))
    for (const n of [
      "11", "12", "13", "14", "15", "16", "17", "18",
      "21", "22", "23", "24", "25", "26", "27", "28",
      "31", "32", "33", "34", "35", "36", "37", "38",
      "41", "42", "43", "44", "45", "46", "47", "48",
    ]) {
      assert.ok(numbers.has(n), `faltou o dente ${n}`)
    }
  })

  await test("decíduos corretos (51..55, 61..65, 71..75, 81..85)", () => {
    const numbers = new Set(catalog.listTeeth("deciduous").map((t) => t.number))
    for (const n of [
      "51", "52", "53", "54", "55",
      "61", "62", "63", "64", "65",
      "71", "72", "73", "74", "75",
      "81", "82", "83", "84", "85",
    ]) {
      assert.ok(numbers.has(n), `faltou o dente decíduo ${n}`)
    }
  })

  await test("dentições não se misturam", () => {
    for (const tooth of catalog.listTeeth("permanent")) {
      assert.equal(tooth.dentition, "permanent")
      assert.ok(tooth.quadrant <= 4)
    }
    for (const tooth of catalog.listTeeth("deciduous")) {
      assert.equal(tooth.dentition, "deciduous")
      assert.ok(tooth.quadrant >= 5)
    }
  })

  await test("tipo de dente correto por posição", () => {
    assert.equal(catalog.getToothDefinition("11").type, "central_incisor")
    assert.equal(catalog.getToothDefinition("13").type, "canine")
    assert.equal(catalog.getToothDefinition("14").type, "first_premolar")
    assert.equal(catalog.getToothDefinition("16").type, "first_molar")
    assert.equal(catalog.getToothDefinition("18").type, "third_molar")
    assert.equal(catalog.getToothDefinition("26").type, "first_molar")
    assert.equal(catalog.getToothDefinition("36").type, "first_molar")
    assert.equal(catalog.getToothDefinition("46").type, "first_molar")
  })

  await test("decídua NÃO possui pré-molares nem terceiros molares", () => {
    const types = new Set(catalog.listTeeth("deciduous").map((t) => t.type))
    assert.ok(!types.has("first_premolar"))
    assert.ok(!types.has("second_premolar"))
    assert.ok(!types.has("third_molar"))
    assert.ok(types.has("first_molar"))
    assert.ok(types.has("second_molar"))
  })

  await test("arcada/quadrante corretos", () => {
    assert.equal(catalog.getToothDefinition("16").arch, "upper")
    assert.equal(catalog.getToothDefinition("16").quadrant, 1)
    assert.equal(catalog.getToothDefinition("26").arch, "upper")
    assert.equal(catalog.getToothDefinition("26").quadrant, 2)
    assert.equal(catalog.getToothDefinition("36").arch, "lower")
    assert.equal(catalog.getToothDefinition("46").arch, "lower")
    assert.equal(catalog.getToothDefinition("65").arch, "upper")
    assert.equal(catalog.getToothDefinition("75").arch, "lower")
  })

  await test("número FDI inválido é rejeitado", () => {
    assert.equal(catalog.getToothDefinition("99"), null)
    assert.equal(catalog.getToothDefinition("1"), null)
    assert.equal(catalog.getToothDefinition(""), null)
    assert.equal(catalog.isKnownToothNumber("99"), false)
  })

  await test("descrição humana do dente", () => {
    assert.equal(catalog.describeTooth("26"), "Primeiro molar superior esquerdo")
    assert.equal(catalog.describeTooth("46"), "Primeiro molar inferior direito")
  })

  await test("linhas do odontograma separam arcada e lado", () => {
    const rows = catalog.buildOdontogramRows("permanent")
    assert.equal(rows.length, 4)
    const upperRight = rows.find((r) => r.arch === "upper" && r.side === "right")
    // Da direita do paciente para a linha média: 18..11.
    assert.equal(upperRight.teeth[0].number, "18")
    assert.equal(upperRight.teeth.at(-1).number, "11")

    const upperLeft = rows.find((r) => r.arch === "upper" && r.side === "left")
    assert.equal(upperLeft.teeth[0].number, "21")
    assert.equal(upperLeft.teeth.at(-1).number, "28")
  })

  // -----------------------------------------------------------------------
  section("(2) Superfícies")
  // -----------------------------------------------------------------------

  await test("normalização remove inválidas, duplicadas e ordena", () => {
    assert.equal(catalog.normalizeSurfaces(["O", "M"]), "M,O")
    assert.equal(catalog.normalizeSurfaces(["o", "m", "o"]), "M,O")
    assert.equal(catalog.normalizeSurfaces(["X", "M", ""]), "M")
    assert.equal(catalog.normalizeSurfaces([]), "")
  })

  await test("parseSurfaces devolve lista tipada", () => {
    assert.deepEqual(catalog.parseSurfaces("D,V"), ["D", "V"])
    assert.deepEqual(catalog.parseSurfaces(""), [])
    assert.deepEqual(catalog.parseSurfaces(null), [])
  })

  await test("face 'O' é exibida como Incisal em dentes anteriores", () => {
    assert.equal(
      catalog.getSurfaceLabel("O", "central_incisor"),
      "Incisal"
    )
    assert.equal(catalog.getSurfaceLabel("O", "first_molar"), "Oclusal")
  })

  // -----------------------------------------------------------------------
  section("(3) Catálogo de condições")
  // -----------------------------------------------------------------------

  await test("catálogo cobre todas as condições exigidas", () => {
    const required = [
      "healthy", "caries", "restoration", "restoration_failure", "fracture",
      "wear", "absent", "extracted", "impacted", "included", "endodontic",
      "crown", "prosthesis", "implant", "veneer", "sealant", "mobility",
      "lesion", "sensitivity", "other",
    ]
    for (const code of required) {
      assert.ok(domain.getCondition(code), `faltou a condição ${code}`)
    }
  })

  await test("toda condição tem código único, categoria e prioridade", () => {
    const codes = new Set()
    for (const condition of domain.CONDITION_CATALOG) {
      assert.ok(!codes.has(condition.code), `código duplicado: ${condition.code}`)
      codes.add(condition.code)
      assert.ok(condition.category, `sem categoria: ${condition.code}`)
      assert.ok(condition.priority >= 1 && condition.priority <= 5)
      assert.ok(condition.name.length > 0)
      assert.ok(condition.description.length > 0)
    }
  })

  await test("categorias produzem representação visual consistente", () => {
    const caries = domain.getConditionVisual("caries")
    const restoration = domain.getConditionVisual("restoration")
    assert.notEqual(caries.dot, restoration.dot)
    // Mesma categoria => mesma representação.
    assert.equal(
      domain.getConditionVisual("restoration").dot,
      domain.getConditionVisual("restoration_failure").dot
    )
  })

  // -----------------------------------------------------------------------
  section("(4) Aplicabilidade de condições")
  // -----------------------------------------------------------------------

  await test("cárie exige superfície", () => {
    const result = domain.validateConditionApplication({
      code: "caries",
      dentition: "permanent",
      toothType: "first_molar",
      surfaces: [],
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, "SURFACE_REQUIRED")
  })

  await test("cárie com superfície é aceita", () => {
    const result = domain.validateConditionApplication({
      code: "caries",
      dentition: "permanent",
      toothType: "first_molar",
      surfaces: ["O"],
    })
    assert.equal(result.ok, true)
  })

  await test("condição inexistente é rejeitada", () => {
    const result = domain.validateConditionApplication({
      code: "nao_existe",
      dentition: "permanent",
      toothType: "first_molar",
      surfaces: [],
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, "UNKNOWN_CONDITION")
  })

  await test("mobilidade não permite múltiplos dentes", () => {
    const result = domain.canApplyToSelection("mobility", [
      { number: "26", dentition: "permanent", type: "first_molar" },
      { number: "36", dentition: "permanent", type: "first_molar" },
    ])
    assert.equal(result.ok, false)
    assert.equal(result.code, "MULTIPLE_NOT_ALLOWED")
  })

  await test("selante permite múltiplos dentes", () => {
    const result = domain.canApplyToSelection("sealant", [
      { number: "16", dentition: "permanent", type: "first_molar" },
      { number: "26", dentition: "permanent", type: "first_molar" },
      { number: "36", dentition: "permanent", type: "first_molar" },
      { number: "46", dentition: "permanent", type: "first_molar" },
    ])
    assert.equal(result.ok, true)
  })

  // -----------------------------------------------------------------------
  section("(5) Projeção do estado atual")
  // -----------------------------------------------------------------------

  await test("sem eventos => saudável, sem códigos", () => {
    const projection = domain.projectToothStatus([])
    assert.equal(projection.status, "healthy")
    assert.deepEqual(projection.conditionCodes, [])
  })

  await test("cárie ativa => estado 'caries'", () => {
    const projection = domain.projectToothStatus([
      { code: "caries", surfaces: "O", status: "active", occurredAt: new Date() },
    ])
    assert.equal(projection.status, "caries")
    assert.deepEqual(projection.conditionCodes, ["caries"])
  })

  await test("estado é a condição ativa de maior prioridade; todas são preservadas", () => {
    const projection = domain.projectToothStatus([
      { code: "caries", surfaces: "O", status: "active", occurredAt: new Date("2026-06-15") },
      { code: "restoration", surfaces: "O", status: "active", occurredAt: new Date("2026-08-02") },
    ])
    // Ambas têm prioridade 5. A projeção nunca é vazia nem concatena códigos.
    assert.ok(["caries", "restoration"].includes(projection.status))
    // Nenhuma condição é apagada: as duas permanecem registradas.
    assert.ok(projection.conditionCodes.includes("caries"))
    assert.ok(projection.conditionCodes.includes("restoration"))
  })

  await test("cárie resolvida (tratada) não compõe mais o estado atual", () => {
    // Após a restauração, a cárie é marcada como "resolved" e o dente passa a
    // ser representado como restaurado — preservando o histórico.
    const projection = domain.projectToothStatus([
      { code: "caries", surfaces: "O", status: "resolved", occurredAt: new Date("2026-06-15") },
      { code: "restoration", surfaces: "O", status: "active", occurredAt: new Date("2026-08-02") },
    ])
    assert.equal(projection.status, "restoration")
    assert.ok(!projection.conditionCodes.includes("caries"))
  })

  await test("regra de resolução: restauração em 'O' resolve cárie em 'O'", () => {
    const ids = domain.resolveCariesForEvent(
      { code: "restoration", surfaces: "O" },
      [
        { id: "c1", surfaces: "O" },
        { id: "c2", surfaces: "V" },
      ]
    )
    assert.deepEqual(ids, ["c1"])
  })

  await test("regra de resolução: cárie em outra superfície permanece ativa", () => {
    const ids = domain.resolveCariesForEvent(
      { code: "restoration", surfaces: "O" },
      [{ id: "c2", surfaces: "M,D" }]
    )
    assert.deepEqual(ids, [])
  })

  await test("regra de resolução: procedimento não resolutivo não altera cárie", () => {
    const ids = domain.resolveCariesForEvent(
      { code: "selante", surfaces: "O" },
      [{ id: "c1", surfaces: "O" }]
    )
    assert.deepEqual(ids, [])
  })

  await test("condição não ativa (resolved) não compõe o estado atual", () => {
    const projection = domain.projectToothStatus([
      { code: "caries", surfaces: "O", status: "resolved", occurredAt: new Date() },
    ])
    assert.equal(projection.status, "healthy")
    assert.deepEqual(projection.conditionCodes, [])
  })

  await test("extraído domina visualmente", () => {
    const projection = domain.projectToothStatus([
      { code: "restoration", surfaces: "O", status: "active", occurredAt: new Date() },
      { code: "extracted", surfaces: "", status: "active", occurredAt: new Date() },
    ])
    assert.equal(projection.status, "extracted")
  })

  // -----------------------------------------------------------------------
  section("(6) Formatação")
  // -----------------------------------------------------------------------

  await test("formatSurfaces usa rótulos clínicos", () => {
    assert.equal(domain.formatSurfaces("O,M"), "M · O")
    assert.equal(domain.formatSurfaces("O", "central_incisor"), "Incisal")
    assert.equal(domain.formatSurfaces(""), "")
  })

  await test("agrupamento por categoria inclui todas as condições", () => {
    const groups = domain.groupConditionsByCategory()
    const total = groups.reduce((sum, g) => sum + g.conditions.length, 0)
    assert.equal(total, domain.CONDITION_CATALOG.length)
  })

  // -----------------------------------------------------------------------
  section("(7) Validação de payload (Zod)")
  // -----------------------------------------------------------------------

  await test("payload válido de condição é aceito", () => {
    const parsed = schemas.registerOdontogramEventSchema.safeParse({
      kind: "condition",
      code: "caries",
      toothNumbers: ["26"],
      dentition: "permanent",
      surfaces: ["O"],
    })
    assert.equal(parsed.success, true)
    assert.equal(parsed.data.surfaces.length, 1)
  })

  await test("condição sem código é rejeitada", () => {
    const parsed = schemas.registerOdontogramEventSchema.safeParse({
      kind: "condition",
      toothNumbers: ["26"],
      dentition: "permanent",
      surfaces: [],
    })
    assert.equal(parsed.success, false)
  })

  await test("procedimento sem procedureId é rejeitado", () => {
    const parsed = schemas.registerOdontogramEventSchema.safeParse({
      kind: "procedure",
      toothNumbers: ["26"],
      dentition: "permanent",
      surfaces: [],
    })
    assert.equal(parsed.success, false)
  })

  await test("número de dente fora do padrão FDI é rejeitado", () => {
    const parsed = schemas.registerOdontogramEventSchema.safeParse({
      kind: "condition",
      code: "caries",
      toothNumbers: ["999"],
      dentition: "permanent",
      surfaces: ["O"],
    })
    assert.equal(parsed.success, false)
  })

  await test("superfície inválida é rejeitada", () => {
    const parsed = schemas.registerOdontogramEventSchema.safeParse({
      kind: "condition",
      code: "caries",
      toothNumbers: ["26"],
      dentition: "permanent",
      surfaces: ["Z"],
    })
    assert.equal(parsed.success, false)
  })

  await test("seleção vazia de dentes é rejeitada", () => {
    const parsed = schemas.registerOdontogramEventSchema.safeParse({
      kind: "condition",
      code: "caries",
      toothNumbers: [],
      dentition: "permanent",
      surfaces: ["O"],
    })
    assert.equal(parsed.success, false)
  })

  await test("status de procedimento só aceita planned/performed", () => {
    const ok = schemas.registerOdontogramEventSchema.safeParse({
      kind: "procedure",
      procedureId: "proc-1",
      toothNumbers: ["36"],
      dentition: "permanent",
      surfaces: [],
      status: "planned",
    })
    assert.equal(ok.success, true)

    const bad = schemas.registerOdontogramEventSchema.safeParse({
      kind: "procedure",
      procedureId: "proc-1",
      toothNumbers: ["36"],
      dentition: "permanent",
      surfaces: [],
      status: "inventado",
    })
    assert.equal(bad.success, false)
  })
}

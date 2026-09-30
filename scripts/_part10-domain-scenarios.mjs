// ===========================================================================
// CENÁRIOS DE DOMÍNIO — PARTE 10 (sem banco).
//
// Cobrem as regras puras dos três módulos:
//   • Plano de tratamento: status, prioridade, agrupamento por etapa, resumo,
//     projeção para o odontograma (PLANEJADO ≠ REALIZADO);
//   • Prescrição: estados, bloqueio de edição, formatação de item;
//   • Documentos: validação de tipo/tamanho, formatação, classificação.
//
// Executado por scripts/test-part10.mjs.
// ===========================================================================

import {
  planDomain,
  prescriptionDomain,
  documentDomain,
  test,
  section,
  assert,
} from "./_part10-harness.mjs"

export async function runDomainScenarios() {
  section("Domínio — Plano de tratamento (10.1)")

  await test("status do item: fechado/iniciado são classificados corretamente", () => {
    assert.equal(planDomain.isClosedItemStatus("completed"), true)
    assert.equal(planDomain.isClosedItemStatus("cancelled"), true)
    assert.equal(planDomain.isClosedItemStatus("not_done"), true)
    assert.equal(planDomain.isClosedItemStatus("planned"), false)
    assert.equal(planDomain.isRunningItemStatus("in_progress"), true)
    assert.equal(planDomain.isRunningItemStatus("partially_done"), true)
    assert.equal(planDomain.isRunningItemStatus("completed"), false)
  })

  await test("resumo do plano deriva contagens reais dos itens", () => {
    const summary = planDomain.summarizePlan([
      { status: "planned", expectedPrice: 100, quantity: 1 },
      { status: "awaiting_start", expectedPrice: 200, quantity: 1 },
      { status: "in_progress", expectedPrice: 50, quantity: 1 },
      { status: "partially_done", expectedPrice: 80, quantity: 1 },
      { status: "completed", expectedPrice: 120, quantity: 1 },
      { status: "completed", expectedPrice: 60, quantity: 2 },
      { status: "cancelled", expectedPrice: 999, quantity: 1 },
      { status: "not_done", expectedPrice: 30, quantity: 1 },
    ])

    assert.equal(summary.totalItems, 8)
    assert.equal(summary.plannedCount, 1)
    assert.equal(summary.awaitingCount, 1)
    assert.equal(summary.inProgressCount, 1)
    assert.equal(summary.partiallyDoneCount, 1)
    assert.equal(summary.completedCount, 2)
    assert.equal(summary.cancelledCount, 1)
    assert.equal(summary.notDoneCount, 1)
    // Pendentes = planned + awaiting_start.
    assert.equal(summary.pendingCount, 2)
    // Abertos = tudo que não está fechado: planned, awaiting, in_progress e
    // partially_done (4 itens). completed/cancelled/not_done estão fechados.
    assert.equal(summary.openCount, 4)
    // Cancelado NÃO entra no valor previsto.
    assert.equal(summary.estimatedTotal, 100 + 200 + 50 + 80 + 120 + 120 + 30)
  })

  await test("progresso percentual ignora itens cancelados", () => {
    const summary = planDomain.summarizePlan([
      { status: "completed", expectedPrice: null, quantity: 1 },
      { status: "planned", expectedPrice: null, quantity: 1 },
      { status: "cancelled", expectedPrice: null, quantity: 1 },
    ])
    // 1 concluído de 2 relevantes = 50%.
    assert.equal(summary.progressPercent, 50)
  })

  await test("agrupamento por etapa mantém a ordem e coloca 'sem etapa' por último", () => {
    const groups = planDomain.groupItemsByStage([
      { stage: null, stageOrder: 0, id: "a" },
      { stage: "Etapa 3 — Restaurações", stageOrder: 3, id: "b" },
      { stage: "Etapa 1 — Avaliação", stageOrder: 1, id: "c" },
    ])
    assert.equal(groups.length, 3)
    assert.equal(groups[0].stage, "Etapa 1 — Avaliação")
    assert.equal(groups[1].stage, "Etapa 3 — Restaurações")
    assert.equal(groups[2].stage, null)
  })

  await test("dentes planejados excluem itens fechados (PLANEJADO ≠ REALIZADO)", () => {
    const teeth = planDomain.collectPlannedTeeth([
      { toothNumber: "16", status: "planned" },
      { toothNumber: "26", status: "in_progress" },
      { toothNumber: "36", status: "completed" },
      { toothNumber: "46", status: "cancelled" },
      { toothNumber: null, status: "planned" },
    ])
    assert.deepEqual(Array.from(teeth).sort(), ["16", "26"])
  })

  await test("validação de dente resolve a dentição do catálogo FDI", () => {
    assert.deepEqual(planDomain.resolvePlanTooth("16", null), {
      toothNumber: "16",
      dentition: "permanent",
    })
    assert.equal(planDomain.resolvePlanTooth("99", null), null)
    // Dente permanente com dentição decídua informada é inválido.
    assert.equal(planDomain.resolvePlanTooth("16", "deciduous"), null)
  })

  await test("referência do dente usa a MESMA convenção do odontograma", () => {
    assert.equal(
      planDomain.formatPlanToothReference("26", ["O"]),
      "Dente 26 • Oclusal"
    )
    // Em dentes anteriores a face oclusal é rotulada "Incisal".
    assert.equal(
      planDomain.formatPlanToothReference("11", ["O"]),
      "Dente 11 • Incisal"
    )
    assert.equal(planDomain.formatPlanToothReference(null, []), null)
  })

  section("Domínio — Prescrição (10.2)")

  await test("estados da prescrição: rascunho editável, emitida bloqueada", () => {
    assert.equal(prescriptionDomain.canEditPrescription("draft"), true)
    assert.equal(prescriptionDomain.canEditPrescription("issued"), false)
    assert.equal(prescriptionDomain.canEditPrescription("cancelled"), false)
    assert.equal(prescriptionDomain.canCancelPrescription("issued"), true)
    assert.equal(prescriptionDomain.canCancelPrescription("cancelled"), false)
  })

  await test("formatação do item compõe apenas o que foi informado", () => {
    const line = prescriptionDomain.formatPrescriptionItemLine({
      name: "Amoxicilina",
      concentration: "500 mg",
      dose: "1 cápsula",
      frequency: "8 em 8 horas",
      duration: "7 dias",
      quantity: 21,
      unit: "cápsulas",
    })
    assert.equal(
      line,
      "Amoxicilina 500 mg — 1 cápsula, 8 em 8 horas, por 7 dias — 21 cápsulas"
    )
  })

  await test("item mínimo (apenas nome) não inventa posologia", () => {
    const line = prescriptionDomain.formatPrescriptionItemLine({
      name: "Dipirona",
    })
    assert.equal(line, "Dipirona")
  })

  section("Domínio — Documentos / Imagens (10.3)")

  await test("upload válido de imagem é aceito", () => {
    const result = documentDomain.validateDocumentFile({
      fileName: "radiografia.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024 * 500,
    })
    assert.equal(result.ok, true)
  })

  await test("upload válido de PDF é aceito", () => {
    const result = documentDomain.validateDocumentFile({
      fileName: "laudo.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024 * 1024,
    })
    assert.equal(result.ok, true)
  })

  await test("arquivo vazio é rejeitado", () => {
    const result = documentDomain.validateDocumentFile({
      fileName: "vazio.png",
      mimeType: "image/png",
      sizeBytes: 0,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, "EMPTY")
  })

  await test("arquivo acima do limite é rejeitado", () => {
    const result = documentDomain.validateDocumentFile({
      fileName: "grande.jpg",
      mimeType: "image/jpeg",
      sizeBytes: documentDomain.MAX_DOCUMENT_SIZE_BYTES + 1,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, "TOO_LARGE")
  })

  await test("tipo de arquivo não suportado é rejeitado (executável)", () => {
    const result = documentDomain.validateDocumentFile({
      fileName: "virus.exe",
      mimeType: "application/x-msdownload",
      sizeBytes: 1024,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, "UNSUPPORTED_TYPE")
  })

  await test("mime vazio mas extensão conhecida é aceito (tolerância a navegadores)", () => {
    const result = documentDomain.validateDocumentFile({
      fileName: "exame.pdf",
      mimeType: "",
      sizeBytes: 2048,
    })
    assert.equal(result.ok, true)
  })

  await test("formatação de tamanho é legível", () => {
    assert.equal(documentDomain.formatFileSize(0), "0 B")
    assert.equal(documentDomain.formatFileSize(512), "512 B")
    assert.equal(documentDomain.formatFileSize(1024), "1 KB")
    assert.equal(documentDomain.formatFileSize(1024 * 1024 * 2), "2 MB")
  })

  await test("classificação de imagem/PDF", () => {
    assert.equal(documentDomain.isImageDocument("image/png"), true)
    assert.equal(documentDomain.isPdfDocument("application/pdf"), true)
    assert.equal(documentDomain.isImageDocument("application/pdf"), false)
  })
}

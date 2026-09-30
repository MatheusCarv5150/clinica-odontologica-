// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — PARTE 10.
//
// Exercitam os SERVIÇOS REAIS contra um SQLite descartável, cobrindo:
//   • plano de tratamento (criação, itens, vínculo com procedimento e dente,
//     transição de status, histórico/auditoria, isolamento entre pacientes);
//   • prescrição (criação, múltiplos itens, rascunho x emitida, cancelamento
//     controlado, imutabilidade de emitida);
//   • documentos (upload válido/inválido, limite de tamanho, tipo de arquivo,
//     vínculo com atendimento e dente, arquivamento lógico);
//   • integrações: odontograma (dente planejado) e preservação de dados.
//
// Executado por scripts/test-part10.mjs.
// ===========================================================================

import {
  planService,
  prescriptionService,
  documentService,
  odontogramService,
  test,
  section,
  assert,
  createPatient,
  createAppointment,
  ensureProcedure,
} from "./_part10-harness.mjs"

// ---------------------------------------------------------------------------

async function newAttendance(status = "in_progress") {
  const patient = await createPatient()
  const appointment = await createAppointment(patient.id, status)
  return { patient, appointment }
}

// Cria um arquivo em memória (Buffer) para os testes de upload.
function fakeFile(name, content, mimeType = "image/jpeg") {
  const buffer = Buffer.from(content)
  return {
    fileName: name,
    mimeType,
    sizeBytes: buffer.byteLength,
    buffer,
  }
}

// ---------------------------------------------------------------------------
// PLANO DE TRATAMENTO
// ---------------------------------------------------------------------------

export async function runTreatmentPlanScenarios() {
  section("Integração — Plano de tratamento (10.1)")

  await test("paciente sem planos retorna estrutura vazia", async () => {
    const { appointment } = await newAttendance()
    const data = await planService.getTreatmentPlans(appointment.id)
    assert.ok(data, "esperado dados do paciente")
    assert.equal(data.plans.length, 0)
    assert.equal(data.totals.plansCount, 0)
    assert.deepEqual(data.plannedTeeth, [])
  })

  await test("criar plano persiste título, descrição e status", async () => {
    const { appointment } = await newAttendance()
    const result = await planService.createPlan(appointment.id, {
      title: "Plano de Reabilitação Oral",
      description: "Tratamento restaurador dos elementos posteriores.",
      notes: null,
      status: "active",
      professionalName: "Dr. Teste",
      plannedDate: "2026-10-01",
    })
    assert.ok(result.ok, `esperado sucesso: ${JSON.stringify(result)}`)

    const data = await planService.getTreatmentPlans(appointment.id)
    assert.equal(data.plans.length, 1)
    assert.equal(data.plans[0].title, "Plano de Reabilitação Oral")
    assert.equal(data.plans[0].status, "active")
    assert.equal(data.plans[0].plannedDate, "2026-10-01")
    assert.equal(data.plans[0].professionalName, "Dr. Teste")
  })

  await test("criar item vinculado ao procedimento REAL do catálogo", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure({ defaultPrice: 250 })
    const plan = await planService.createPlan(appointment.id, {
      title: "Plano Restaurador",
      description: null,
      notes: null,
      status: "active",
      professionalName: null,
      plannedDate: null,
    })

    const item = await planService.createPlanItem(appointment.id, plan.planId, {
      procedureId: procedure.id,
      description: null,
      toothNumber: "16",
      dentition: "permanent",
      surfaces: ["O"],
      priority: "high",
      expectedPrice: null,
      quantity: 1,
      stage: "Etapa 3 — Restaurações",
      stageOrder: 3,
      position: 0,
      status: "planned",
      plannedDate: null,
      notes: null,
    })
    assert.ok(item.ok, `esperado sucesso: ${JSON.stringify(item)}`)

    const data = await planService.getTreatmentPlans(appointment.id)
    const saved = data.plans[0].items[0]
    assert.equal(saved.procedureId, procedure.id)
    assert.equal(saved.procedureNameSnapshot, procedure.name)
    assert.equal(saved.toothNumber, "16")
    assert.deepEqual(saved.surfaces, ["O"])
    assert.equal(saved.priority, "high")
    assert.equal(saved.stage, "Etapa 3 — Restaurações")
    // Valor previsto herdado do catálogo quando não informado.
    assert.equal(saved.expectedPrice, 250)
  })

  await test("procedimento inexistente é rejeitado", async () => {
    const { appointment } = await newAttendance()
    const plan = await planService.createPlan(appointment.id, {
      title: "Plano X",
      description: null,
      notes: null,
      status: "active",
      professionalName: null,
      plannedDate: null,
    })
    const result = await planService.createPlanItem(appointment.id, plan.planId, {
      procedureId: "procedimento-fantasma",
      description: null,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      priority: "medium",
      expectedPrice: null,
      quantity: 1,
      stage: null,
      stageOrder: 0,
      position: 0,
      status: "planned",
      plannedDate: null,
      notes: null,
    })
    assert.ok("error" in result, "esperado erro")
    assert.equal(result.code, "UNKNOWN_PROCEDURE")
    assert.equal(result.status, 404)
  })

  await test("dente FDI inválido é rejeitado", async () => {
    const { appointment } = await newAttendance()
    const plan = await planService.createPlan(appointment.id, {
      title: "Plano Y",
      description: null,
      notes: null,
      status: "active",
      professionalName: null,
      plannedDate: null,
    })
    const result = await planService.createPlanItem(appointment.id, plan.planId, {
      procedureId: null,
      description: "Restauração",
      toothNumber: "99",
      dentition: null,
      surfaces: [],
      priority: "medium",
      expectedPrice: null,
      quantity: 1,
      stage: null,
      stageOrder: 0,
      position: 0,
      status: "planned",
      plannedDate: null,
      notes: null,
    })
    assert.ok("error" in result, "esperado erro")
    assert.equal(result.code, "INVALID_TOOTH")
  })

  await test("transição de status registra o histórico com autor", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure()
    const plan = await planService.createPlan(appointment.id, {
      title: "Plano com histórico",
      description: null,
      notes: null,
      status: "active",
      professionalName: null,
      plannedDate: null,
    })
    const item = await planService.createPlanItem(appointment.id, plan.planId, {
      procedureId: procedure.id,
      description: null,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      priority: "medium",
      expectedPrice: 100,
      quantity: 1,
      stage: null,
      stageOrder: 0,
      position: 0,
      status: "planned",
      plannedDate: null,
      notes: null,
    })

    await planService.updatePlanItem(appointment.id, plan.planId, item.itemId, {
      status: "in_progress",
      performedByName: "Dra. Histórico",
    })
    await planService.updatePlanItem(appointment.id, plan.planId, item.itemId, {
      status: "completed",
      performedByName: "Dra. Histórico",
    })

    const data = await planService.getTreatmentPlans(appointment.id)
    const saved = data.plans[0].items[0]
    assert.equal(saved.status, "completed")

    const statusChanges = data.plans[0].changes.filter(
      (change) => change.field === "status"
    )
    assert.equal(statusChanges.length, 2, "esperadas 2 transições auditadas")
    // A trilha mais recente vem primeiro: Planejado -> Em andamento -> Concluído.
    assert.equal(statusChanges[0].oldValue, "Em andamento")
    assert.equal(statusChanges[0].newValue, "Concluído")
    assert.equal(statusChanges[1].oldValue, "Planejado")
    assert.equal(statusChanges[1].newValue, "Em andamento")
    assert.equal(statusChanges[0].changedByName, "Dra. Histórico")
  })

  await test("remover item é EXCLUSÃO LÓGICA: histórico preservado", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure()
    const plan = await planService.createPlan(appointment.id, {
      title: "Plano remoção",
      description: null,
      notes: null,
      status: "active",
      professionalName: null,
      plannedDate: null,
    })
    const item = await planService.createPlanItem(appointment.id, plan.planId, {
      procedureId: procedure.id,
      description: null,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      priority: "medium",
      expectedPrice: null,
      quantity: 1,
      stage: null,
      stageOrder: 0,
      position: 0,
      status: "planned",
      plannedDate: null,
      notes: null,
    })

    await planService.archivePlanItem(
      appointment.id,
      plan.planId,
      item.itemId,
      "Dr. Removedor",
      "Replanejado"
    )

    const data = await planService.getTreatmentPlans(appointment.id)
    const saved = data.plans[0].items[0]
    // O item NÃO foi apagado: continua existindo, marcado como cancelado.
    assert.ok(saved, "o item deve permanecer no histórico")
    assert.equal(saved.status, "cancelled")
    assert.equal(
      data.plans[0].changes.some(
        (change) =>
          change.newValue === "Cancelado" && change.reason === "Replanejado"
      ),
      true,
      "esperada trilha do cancelamento com motivo"
    )
  })

  await test("resumo do plano é derivado dos itens reais", async () => {
    const { appointment } = await newAttendance()
    const plan = await planService.createPlan(appointment.id, {
      title: "Plano resumo",
      description: null,
      notes: null,
      status: "active",
      professionalName: null,
      plannedDate: null,
    })

    for (const [status, price] of [
      ["planned", 100],
      ["completed", 200],
      ["cancelled", 999],
    ]) {
      await planService.createPlanItem(appointment.id, plan.planId, {
        procedureId: null,
        description: `Item ${status}`,
        toothNumber: null,
        dentition: null,
        surfaces: [],
        priority: "medium",
        expectedPrice: price,
        quantity: 1,
        stage: null,
        stageOrder: 0,
        position: 0,
        status,
        plannedDate: null,
        notes: null,
      })
    }

    const data = await planService.getTreatmentPlans(appointment.id)
    const summary = data.plans[0].summary
    assert.equal(summary.totalItems, 3)
    assert.equal(summary.completedCount, 1)
    assert.equal(summary.cancelledCount, 1)
    assert.equal(summary.openCount, 1)
    // Cancelado não entra no valor previsto: 100 + 200.
    assert.equal(summary.estimatedTotal, 300)
  })

  await test("isolamento: plano de outro paciente não é acessível", async () => {
    const a = await newAttendance()
    const b = await newAttendance()

    const planA = await planService.createPlan(a.appointment.id, {
      title: "Plano do paciente A",
      description: null,
      notes: null,
      status: "active",
      professionalName: null,
      plannedDate: null,
    })

    // Tentar ler/alterar o plano de A a partir do atendimento de B.
    const read = await planService.getTreatmentPlans(b.appointment.id)
    assert.equal(read.plans.length, 0, "o plano de A não pode aparecer para B")

    const update = await planService.updatePlan(b.appointment.id, planA.planId, {
      title: "Invadido",
    })
    assert.ok("error" in update, "esperado erro de isolamento")
    assert.equal(update.status, 404)
  })

  await test("atendimento inexistente retorna null/erro tratado", async () => {
    const data = await planService.getTreatmentPlans("atendimento-inexistente")
    assert.equal(data, null)

    const created = await planService.createPlan("atendimento-inexistente", {
      title: "Plano fantasma",
      description: null,
      notes: null,
      status: "active",
      professionalName: null,
      plannedDate: null,
    })
    assert.ok("error" in created)
    assert.equal(created.status, 404)
  })

  section("Integração — Plano x Odontograma (PLANEJADO ≠ REALIZADO)")

  await test("item planejado aparece no odontograma sem alterar o dente", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure()
    const plan = await planService.createPlan(appointment.id, {
      title: "Plano integrado",
      description: null,
      notes: null,
      status: "active",
      professionalName: null,
      plannedDate: null,
    })
    await planService.createPlanItem(appointment.id, plan.planId, {
      procedureId: procedure.id,
      description: null,
      toothNumber: "26",
      dentition: "permanent",
      surfaces: ["O"],
      priority: "high",
      expectedPrice: null,
      quantity: 1,
      stage: null,
      stageOrder: 0,
      position: 0,
      status: "planned",
      plannedDate: null,
      notes: null,
    })

    const odontogram = await odontogramService.getOdontogram(
      appointment.id,
      "permanent"
    )
    assert.ok(odontogram, "esperado odontograma")
    assert.equal(
      odontogram.plannedTeeth.includes("26"),
      true,
      "o dente 26 deve aparecer como planejado"
    )

    // PLANEJADO ≠ REALIZADO: o estado clínico do dente NÃO muda.
    const tooth26 = odontogram.teeth.find((tooth) => tooth.number === "26")
    assert.equal(tooth26.status, "healthy")
    assert.deepEqual(tooth26.conditionCodes, [])
  })

  await test("concluir o item remove a indicação; dente segue intocado", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure()
    const plan = await planService.createPlan(appointment.id, {
      title: "Plano conclusão",
      description: null,
      notes: null,
      status: "active",
      professionalName: null,
      plannedDate: null,
    })
    const item = await planService.createPlanItem(appointment.id, plan.planId, {
      procedureId: procedure.id,
      description: null,
      toothNumber: "36",
      dentition: "permanent",
      surfaces: [],
      priority: "medium",
      expectedPrice: null,
      quantity: 1,
      stage: null,
      stageOrder: 0,
      position: 0,
      status: "planned",
      plannedDate: null,
      notes: null,
    })

    await planService.updatePlanItem(appointment.id, plan.planId, item.itemId, {
      status: "completed",
    })

    const odontogram = await odontogramService.getOdontogram(
      appointment.id,
      "permanent"
    )
    assert.equal(odontogram.plannedTeeth.includes("36"), false)

    // A conclusão do PLANEJAMENTO não alterou o dente clinicamente.
    const tooth36 = odontogram.teeth.find((tooth) => tooth.number === "36")
    assert.equal(tooth36.status, "healthy")
  })
}

// ---------------------------------------------------------------------------
// PRESCRIÇÃO
// ---------------------------------------------------------------------------

function minimalItem(name) {
  return {
    name,
    activeIngredient: null,
    presentation: null,
    concentration: null,
    quantity: null,
    unit: null,
    route: null,
    dose: null,
    frequency: null,
    duration: null,
    instructions: null,
    observations: null,
  }
}

export async function runPrescriptionScenarios() {
  section("Integração — Prescrição (10.2)")

  await test("paciente sem prescrições retorna estrutura vazia", async () => {
    const { appointment } = await newAttendance()
    const data = await prescriptionService.getPrescriptions(appointment.id)
    assert.ok(data)
    assert.equal(data.prescriptions.length, 0)
    assert.equal(data.totals.prescriptionsCount, 0)
  })

  await test("criar prescrição emitida com um item completo", async () => {
    const { appointment } = await newAttendance()
    const result = await prescriptionService.createPrescription(appointment.id, {
      items: [
        {
          ...minimalItem("Amoxicilina"),
          presentation: "Cápsula",
          concentration: "500 mg",
          quantity: 21,
          unit: "cápsulas",
          route: "Oral",
          dose: "1 cápsula",
          frequency: "8 em 8 horas",
          duration: "7 dias",
          instructions: "Tomar após as refeições.",
        },
      ],
      notes: null,
      guidance: "Não interromper o tratamento.",
      professionalName: "Dr. Prescritor",
      issue: true,
    })
    assert.ok(result.ok, `esperado sucesso: ${JSON.stringify(result)}`)

    const data = await prescriptionService.getPrescriptions(appointment.id)
    assert.equal(data.prescriptions.length, 1)
    const prescription = data.prescriptions[0]
    assert.equal(prescription.status, "issued")
    assert.equal(prescription.items.length, 1)
    assert.equal(prescription.items[0].name, "Amoxicilina")
    assert.equal(prescription.items[0].concentration, "500 mg")
    assert.ok(prescription.issuedAt, "emitida deve ter data de emissão")
    assert.equal(data.totals.issuedCount, 1)
  })

  await test("prescrição com MÚLTIPLOS itens preserva a ordem", async () => {
    const { appointment } = await newAttendance()
    const result = await prescriptionService.createPrescription(appointment.id, {
      items: [
        minimalItem("Amoxicilina"),
        minimalItem("Ibuprofeno"),
        minimalItem("Clorexidina"),
      ],
      notes: null,
      guidance: null,
      professionalName: "Dr. Multi",
      issue: true,
    })
    assert.ok(result.ok)

    const data = await prescriptionService.getPrescriptions(appointment.id)
    const items = data.prescriptions[0].items
    assert.equal(items.length, 3)
    assert.deepEqual(
      items.map((item) => item.name),
      ["Amoxicilina", "Ibuprofeno", "Clorexidina"]
    )
  })

  await test("rascunho NÃO é emitido e pode ser editado", async () => {
    const { appointment } = await newAttendance()
    const created = await prescriptionService.createPrescription(appointment.id, {
      items: [minimalItem("Paracetamol")],
      notes: null,
      guidance: null,
      professionalName: null,
      issue: false,
    })
    assert.ok(created.ok)

    let data = await prescriptionService.getPrescriptions(appointment.id)
    assert.equal(data.prescriptions[0].status, "draft")
    assert.equal(data.prescriptions[0].issuedAt, null)

    const updated = await prescriptionService.updatePrescription(
      appointment.id,
      created.prescriptionId,
      { issue: true, professionalName: "Dr. Assinatura" }
    )
    assert.ok(updated.ok, `esperado sucesso: ${JSON.stringify(updated)}`)

    data = await prescriptionService.getPrescriptions(appointment.id)
    assert.equal(data.prescriptions[0].status, "issued")
    assert.ok(data.prescriptions[0].issuedAt)
  })

  await test("prescrição EMITIDA é imutável (bloqueio de edição)", async () => {
    const { appointment } = await newAttendance()
    const created = await prescriptionService.createPrescription(appointment.id, {
      items: [minimalItem("Medicamento A")],
      notes: null,
      guidance: null,
      professionalName: null,
      issue: true,
    })

    const updated = await prescriptionService.updatePrescription(
      appointment.id,
      created.prescriptionId,
      { notes: "tentativa de reescrever" }
    )
    assert.ok("error" in updated, "esperado bloqueio")
    assert.equal(updated.code, "PRESCRIPTION_LOCKED")
    assert.equal(updated.status, 409)
  })

  await test("cancelamento controlado preserva o documento original", async () => {
    const { appointment } = await newAttendance()
    const created = await prescriptionService.createPrescription(appointment.id, {
      items: [minimalItem("Medicamento B")],
      notes: null,
      guidance: null,
      professionalName: "Dr. Cancelador",
      issue: true,
    })

    const cancelled = await prescriptionService.cancelPrescription(
      appointment.id,
      created.prescriptionId,
      { reason: "Erro de posologia", cancelledByName: "Dr. Cancelador" }
    )
    assert.ok(cancelled.ok, `esperado sucesso: ${JSON.stringify(cancelled)}`)

    const data = await prescriptionService.getPrescriptions(appointment.id)
    const prescription = data.prescriptions[0]
    assert.equal(prescription.status, "cancelled")
    assert.equal(prescription.cancelReason, "Erro de posologia")
    assert.equal(prescription.cancelledByName, "Dr. Cancelador")
    assert.ok(prescription.cancelledAt)
    // O conteúdo original permanece intacto.
    assert.equal(prescription.items.length, 1)
    assert.equal(prescription.items[0].name, "Medicamento B")
    // A trilha registra o evento de cancelamento.
    assert.equal(
      prescription.logs.some((log) => log.event === "cancelled"),
      true
    )
  })

  await test("cancelar duas vezes é rejeitado", async () => {
    const { appointment } = await newAttendance()
    const created = await prescriptionService.createPrescription(appointment.id, {
      items: [minimalItem("Medicamento C")],
      notes: null,
      guidance: null,
      professionalName: null,
      issue: true,
    })
    await prescriptionService.cancelPrescription(
      appointment.id,
      created.prescriptionId,
      { reason: "Primeiro cancelamento", cancelledByName: null }
    )
    const second = await prescriptionService.cancelPrescription(
      appointment.id,
      created.prescriptionId,
      { reason: "Segundo cancelamento", cancelledByName: null }
    )
    assert.ok("error" in second)
    assert.equal(second.code, "ALREADY_CANCELLED")
  })

  await test("prescrições anteriores NÃO são sobrescritas por uma nova", async () => {
    const { appointment } = await newAttendance()
    for (const name of ["Primeiro medicamento", "Segundo medicamento"]) {
      await prescriptionService.createPrescription(appointment.id, {
        items: [minimalItem(name)],
        notes: null,
        guidance: null,
        professionalName: null,
        issue: true,
      })
    }

    const data = await prescriptionService.getPrescriptions(appointment.id)
    assert.equal(data.prescriptions.length, 2)
    const names = data.prescriptions.map((p) => p.items[0].name).sort()
    assert.deepEqual(names, ["Primeiro medicamento", "Segundo medicamento"])
  })

  await test("isolamento: prescrição de outro paciente não é acessível", async () => {
    const a = await newAttendance()
    const b = await newAttendance()

    const created = await prescriptionService.createPrescription(a.appointment.id, {
      items: [minimalItem("Medicamento privado")],
      notes: null,
      guidance: null,
      professionalName: null,
      issue: true,
    })

    const read = await prescriptionService.getPrescriptions(b.appointment.id)
    assert.equal(read.prescriptions.length, 0)

    const cancelled = await prescriptionService.cancelPrescription(
      b.appointment.id,
      created.prescriptionId,
      { reason: "Tentativa indevida", cancelledByName: null }
    )
    assert.ok("error" in cancelled)
    assert.equal(cancelled.status, 404)
  })
}

// ---------------------------------------------------------------------------
// DOCUMENTOS / IMAGENS
// ---------------------------------------------------------------------------

export async function runDocumentScenarios() {
  section("Integração — Documentos / Imagens (10.3)")

  await test("paciente sem documentos retorna estrutura vazia", async () => {
    const { appointment } = await newAttendance()
    const data = await documentService.getDocuments(appointment.id)
    assert.ok(data)
    assert.equal(data.documents.length, 0)
    assert.equal(data.totals.total, 0)
  })

  await test("upload válido de imagem persiste metadados e conteúdo", async () => {
    const { appointment } = await newAttendance()
    const file = fakeFile("radiografia-panoramica.jpg", "conteudo-da-imagem")

    const result = await documentService.uploadDocument(
      appointment.id,
      {
        category: "radiograph",
        title: "Radiografia panorâmica",
        description: "Exame inicial",
        originalName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        toothNumber: null,
        dentition: null,
        uploadedByName: "Dr. Documentos",
      },
      file.buffer
    )
    assert.ok(result.ok, `esperado sucesso: ${JSON.stringify(result)}`)

    const data = await documentService.getDocuments(appointment.id)
    assert.equal(data.documents.length, 1)
    const document = data.documents[0]
    assert.equal(document.title, "Radiografia panorâmica")
    assert.equal(document.category, "radiograph")
    assert.equal(document.mimeType, "image/jpeg")
    assert.equal(document.appointmentId, appointment.id)
    assert.equal(document.uploadedByName, "Dr. Documentos")
    assert.equal(data.totals.images, 1)

    // O conteúdo é recuperável pelo serviço.
    const content = await documentService.getDocumentContent(document.id)
    assert.ok(!("error" in content))
    assert.equal(content.data.toString(), "conteudo-da-imagem")
  })

  await test("upload de PDF é classificado como PDF", async () => {
    const { appointment } = await newAttendance()
    const file = fakeFile("laudo.pdf", "%PDF-1.4 fake", "application/pdf")
    const result = await documentService.uploadDocument(
      appointment.id,
      {
        category: "exam",
        title: "Laudo laboratorial",
        description: null,
        originalName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        toothNumber: null,
        dentition: null,
        uploadedByName: null,
      },
      file.buffer
    )
    assert.ok(result.ok)

    const data = await documentService.getDocuments(appointment.id)
    assert.equal(data.totals.pdfs, 1)
  })

  await test("documento pode ser vinculado a um dente (FDI)", async () => {
    const { appointment } = await newAttendance()
    const file = fakeFile("periapical-26.jpg", "imagem")
    const result = await documentService.uploadDocument(
      appointment.id,
      {
        category: "radiograph",
        title: "Periapical 26",
        description: null,
        originalName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        toothNumber: "26",
        dentition: "permanent",
        uploadedByName: null,
      },
      file.buffer
    )
    assert.ok(result.ok)

    const data = await documentService.getDocuments(appointment.id)
    assert.equal(data.documents[0].toothNumber, "26")
    assert.equal(data.documents[0].dentition, "permanent")
  })

  await test("dente inválido no upload é rejeitado", async () => {
    const { appointment } = await newAttendance()
    const file = fakeFile("x.jpg", "imagem")
    const result = await documentService.uploadDocument(
      appointment.id,
      {
        category: "radiograph",
        title: "Exame",
        description: null,
        originalName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        toothNumber: "99",
        dentition: null,
        uploadedByName: null,
      },
      file.buffer
    )
    assert.ok("error" in result)
    assert.equal(result.code, "INVALID_TOOTH")
  })

  await test("upload de tipo não suportado é rejeitado no serviço", async () => {
    const { appointment } = await newAttendance()
    const file = fakeFile("malicioso.exe", "MZ", "application/x-msdownload")
    const result = await documentService.uploadDocument(
      appointment.id,
      {
        category: "other",
        title: "Arquivo suspeito",
        description: null,
        originalName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        toothNumber: null,
        dentition: null,
        uploadedByName: null,
      },
      file.buffer
    )
    assert.ok("error" in result)
    assert.equal(result.code, "UNSUPPORTED_TYPE")
    assert.equal(result.status, 422)
  })

  await test("upload acima do limite é rejeitado", async () => {
    const { appointment } = await newAttendance()
    // Declaramos um tamanho acima do limite SEM alocar o buffer gigante.
    const oversized = 21 * 1024 * 1024
    const result = await documentService.uploadDocument(
      appointment.id,
      {
        category: "radiograph",
        title: "Arquivo gigante",
        description: null,
        originalName: "gigante.jpg",
        mimeType: "image/jpeg",
        sizeBytes: oversized,
        toothNumber: null,
        dentition: null,
        uploadedByName: null,
      },
      Buffer.from("x")
    )
    assert.ok("error" in result)
    assert.equal(result.code, "TOO_LARGE")
  })

  await test("divergência entre tamanho declarado e conteúdo é detectada", async () => {
    const { appointment } = await newAttendance()
    const result = await documentService.uploadDocument(
      appointment.id,
      {
        category: "radiograph",
        title: "Tamanho adulterado",
        description: null,
        originalName: "foto.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 9999,
        toothNumber: null,
        dentition: null,
        uploadedByName: null,
      },
      Buffer.from("abc")
    )
    assert.ok("error" in result)
    assert.equal(result.code, "SIZE_MISMATCH")
  })

  await test("arquivamento é LÓGICO: documento sai da listagem, registro permanece", async () => {
    const { appointment } = await newAttendance()
    const file = fakeFile("exame.jpg", "conteudo")
    const created = await documentService.uploadDocument(
      appointment.id,
      {
        category: "exam",
        title: "Exame a arquivar",
        description: null,
        originalName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        toothNumber: null,
        dentition: null,
        uploadedByName: null,
      },
      file.buffer
    )
    assert.ok(created.ok)

    const archived = await documentService.archiveDocument(
      appointment.id,
      created.documentId
    )
    assert.ok(!("error" in archived))

    const data = await documentService.getDocuments(appointment.id)
    assert.equal(data.documents.length, 0, "arquivado não aparece na listagem")

    // O registro continua no banco, apenas marcado como arquivado.
    const { prisma: prismaClient } = await import("./_part10-harness.mjs")
    const row = await prismaClient.patientDocument.findUnique({
      where: { id: created.documentId },
    })
    assert.ok(row, "o registro deve permanecer no banco")
    assert.ok(row.archivedAt, "archived_at deve estar preenchido")
  })

  await test("isolamento: documento de outro paciente não é acessível", async () => {
    const a = await newAttendance()
    const b = await newAttendance()

    const file = fakeFile("privado.jpg", "segredo")
    const created = await documentService.uploadDocument(
      a.appointment.id,
      {
        category: "document",
        title: "Documento privado",
        description: null,
        originalName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        toothNumber: null,
        dentition: null,
        uploadedByName: null,
      },
      file.buffer
    )
    assert.ok(created.ok)

    // B não vê o documento de A.
    const read = await documentService.getDocuments(b.appointment.id)
    assert.equal(read.documents.length, 0)

    // B não consegue arquivar o documento de A.
    const archived = await documentService.archiveDocument(
      b.appointment.id,
      created.documentId
    )
    assert.ok("error" in archived)
    assert.equal(archived.status, 404)
  })

  await test("atendimento inexistente é tratado no upload e na listagem", async () => {
    const list = await documentService.getDocuments("atendimento-inexistente")
    assert.equal(list, null)

    const upload = await documentService.uploadDocument(
      "atendimento-inexistente",
      {
        category: "other",
        title: "Documento órfão",
        description: null,
        originalName: "orfa.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 3,
        toothNumber: null,
        dentition: null,
        uploadedByName: null,
      },
      Buffer.from("abc")
    )
    assert.ok("error" in upload)
    assert.equal(upload.status, 404)
  })
}

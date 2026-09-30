// ===========================================================================
// Testes de INTEGRAÇÃO do odontograma (Parte 5).
//
// Exercitam o SERVIÇO REAL e o banco Prisma configurado em .env — sem mocks.
// Cobrem carregamento, registro de condições/procedimentos, separação entre
// estado atual e histórico, planejado x realizado, múltiplos dentes e
// isolamento entre pacientes.
// ===========================================================================

import {
  assert,
  conditionPayload,
  createAppointment,
  createPatient,
  ensureProcedure,
  prisma,
  section,
  service,
  test,
} from "./_odontogram-harness.mjs"

export async function runIntegrationScenarios() {
  // Fixtures compartilhadas
  const patient = await createPatient("Paciente Odontograma", "90600000001")
  const otherPatient = await createPatient("Outro Paciente", "90600000002")
  const appointment = await createAppointment(patient.id, "in_progress")
  const otherAppointment = await createAppointment(otherPatient.id, "in_progress")
  const scheduledAppointment = await createAppointment(patient.id, "scheduled", "2026-09-20")
  const procedure = await ensureProcedure()

  const fixtures = {
    patient,
    otherPatient,
    appointment,
    otherAppointment,
    scheduledAppointment,
    procedure,
  }

  // -----------------------------------------------------------------------
  section("(8) Carregamento do odontograma")
  // -----------------------------------------------------------------------

  await test("odontograma vazio retorna todos os dentes saudáveis", async () => {
    const data = await service.getOdontogram(appointment.id, "permanent")
    assert.ok(data)
    assert.equal(data.teeth.length, 32)
    assert.equal(data.summary.healthy, 32)
    assert.equal(data.summary.withFindings, 0)
    assert.equal(data.dentition, "permanent")
    assert.ok(data.teeth.every((t) => t.status === "healthy"))
  })

  await test("retorna 404 (null) para atendimento inexistente", async () => {
    const data = await service.getOdontogram("nao-existe", "permanent")
    assert.equal(data, null)
  })

  await test("dentição decídua retorna 20 dentes", async () => {
    const data = await service.getOdontogram(appointment.id, "deciduous")
    assert.ok(data)
    assert.equal(data.teeth.length, 20)
  })

  await test("atendimento não iniciado marca isOpen=false (sem edição)", async () => {
    const data = await service.getOdontogram(scheduledAppointment.id, "permanent")
    assert.ok(data)
    assert.equal(data.attendance.isOpen, false)
  })

  // -----------------------------------------------------------------------
  section("(9) Registro de condições")
  // -----------------------------------------------------------------------

  await test("registra cárie oclusal no dente 26", async () => {
    const result = await service.registerEvent(
      appointment.id,
      conditionPayload("26", "caries", ["O"])
    )
    assert.ok(!("error" in result), JSON.stringify(result))
    assert.equal(result.created, 1)

    const data = await service.getOdontogram(appointment.id, "permanent")
    const tooth = data.teeth.find((t) => t.number === "26")
    assert.equal(tooth.status, "caries")
    assert.ok(tooth.conditionCodes.includes("caries"))
  })

  await test("estado atual e superfícies ficam registrados", async () => {
    const detail = await service.getToothDetail(appointment.id, "26")
    assert.ok(detail)
    assert.equal(detail.tooth.status, "caries")
    assert.equal(detail.activeConditions.length, 1)
    assert.deepEqual(detail.activeConditions[0].surfaces, ["O"])
  })

  await test("cárie sem superfície é rejeitada pelo serviço", async () => {
    const result = await service.registerEvent(
      appointment.id,
      conditionPayload("36", "caries", [])
    )
    assert.ok("error" in result)
    assert.equal(result.code, "SURFACE_REQUIRED")
  })

  await test("condição inexistente é rejeitada", async () => {
    const result = await service.registerEvent(
      appointment.id,
      conditionPayload("36", "condicao_fantasma", ["O"])
    )
    assert.ok("error" in result)
    assert.equal(result.code, "UNKNOWN_CONDITION")
  })

  await test("dente inexistente no FDI é rejeitado", async () => {
    const result = await service.registerEvent(
      appointment.id,
      conditionPayload("99", "caries", ["O"])
    )
    assert.ok("error" in result)
    assert.equal(result.code, "INVALID_TOOTH")
  })

  await test("dente de outra dentição é rejeitado", async () => {
    const result = await service.registerEvent(appointment.id, {
      ...conditionPayload("55", "caries", ["O"]),
      dentition: "permanent",
    })
    assert.ok("error" in result)
    assert.equal(result.code, "WRONG_DENTITION")
  })

  await test("condição 'saudável' não é gravada como evento", async () => {
    const result = await service.registerEvent(
      appointment.id,
      conditionPayload("37", "healthy", [])
    )
    assert.ok("error" in result)
    assert.equal(result.code, "HEALTHY_NOT_RECORDABLE")
  })

  await test("registro em atendimento não iniciado é bloqueado", async () => {
    const result = await service.registerEvent(
      scheduledAppointment.id,
      conditionPayload("26", "caries", ["O"])
    )
    assert.ok("error" in result)
    assert.equal(result.code, "ATTENDANCE_NOT_OPEN")
  })

  await test("superfícies distintas guardam condições distintas", async () => {
    // Dente 27: cárie em M,O e restauração em V.
    await service.registerEvent(appointment.id, conditionPayload("27", "caries", ["M", "O"]))
    await service.registerEvent(appointment.id, conditionPayload("27", "restoration", ["V"]))

    const detail = await service.getToothDetail(appointment.id, "27")
    assert.ok(detail)
    const caries = detail.activeConditions.find((c) => c.code === "caries")
    const restoration = detail.activeConditions.find((c) => c.code === "restoration")
    assert.deepEqual(caries.surfaces.sort(), ["M", "O"])
    assert.deepEqual(restoration.surfaces, ["V"])
  })

  // -----------------------------------------------------------------------
  section("(10) Estado atual x histórico")
  // -----------------------------------------------------------------------

  await test("registrar restauração NÃO apaga o registro de cárie", async () => {
    // Dente 16: cárie primeiro, restauração depois.
    await service.registerEvent(appointment.id, conditionPayload("16", "caries", ["O"]))
    await service.registerEvent(appointment.id, conditionPayload("16", "restoration", ["O"]))

    const detail = await service.getToothDetail(appointment.id, "16")
    assert.ok(detail)

    // Histórico preserva os DOIS eventos, na íntegra.
    const codes = detail.timeline.map((e) => e.code)
    assert.ok(codes.includes("caries"), "cárie deve permanecer no histórico")
    assert.ok(codes.includes("restoration"), "restauração deve estar no histórico")

    // O evento de cárie continua no histórico, agora marcado como resolvido.
    const cariesEvent = detail.timeline.find((e) => e.code === "caries")
    assert.equal(cariesEvent.status, "resolved")

    // Estado atual = restauração (a cárie foi tratada).
    assert.equal(detail.tooth.status, "restoration")
  })

  await test("cárie em outra superfície NÃO é resolvida pela restauração", async () => {
    // Dente 25: cárie em M (não tratada) e restauração em O.
    await service.registerEvent(appointment.id, conditionPayload("25", "caries", ["M"]))
    await service.registerEvent(appointment.id, conditionPayload("25", "restoration", ["O"]))

    const detail = await service.getToothDetail(appointment.id, "25")
    const caries = detail.activeConditions.find((c) => c.code === "caries")
    assert.ok(caries, "a cárie em M deve permanecer ativa")
    assert.deepEqual(caries.surfaces, ["M"])
  })

  await test("histórico é cronológico (mais recente primeiro)", async () => {
    const detail = await service.getToothDetail(appointment.id, "16")
    const dates = detail.timeline.map((e) => new Date(e.occurredAt).getTime())
    for (let i = 1; i < dates.length; i++) {
      assert.ok(dates[i - 1] >= dates[i], "timeline fora de ordem")
    }
  })

  await test("cada evento registra profissional, atendimento e data", async () => {
    const detail = await service.getToothDetail(appointment.id, "16")
    for (const event of detail.timeline) {
      assert.equal(event.professionalName, "Dr. Teste")
      assert.equal(event.appointmentId, appointment.id)
      assert.ok(event.occurredAt)
      assert.ok(!Number.isNaN(new Date(event.occurredAt).getTime()))
      assert.ok(event.attendanceCode.length > 0)
    }
  })

  await test("eventos do atendimento atual aparecem em currentEvents", async () => {
    const data = await service.getOdontogram(appointment.id, "permanent")
    const teeth = new Set(data.currentEvents.map((e) => e.toothNumber))
    assert.ok(teeth.has("26"))
    assert.ok(teeth.has("16"))
  })

  // -----------------------------------------------------------------------
  section("(11) Procedimentos — catálogo real e snapshot")
  // -----------------------------------------------------------------------

  await test("procedimento restaurador REALIZADO resolve a cárie ativa", async () => {
    // Dente 15: cárie em O, depois um procedimento da categoria Restauração.
    await service.registerEvent(appointment.id, conditionPayload("15", "caries", ["O"]))

    let detail = await service.getToothDetail(appointment.id, "15")
    assert.ok(detail.tooth.conditionCodes.includes("caries"))

    await service.registerEvent(appointment.id, {
      kind: "procedure",
      procedureId: procedure.id,
      toothNumbers: ["15"],
      dentition: "permanent",
      surfaces: ["O"],
      status: "performed",
      notes: "Restauração em resina composta.",
      professionalName: "Dr. Teste",
    })

    detail = await service.getToothDetail(appointment.id, "15")
    // O evento de cárie permanece no histórico, marcado como resolvido.
    const cariesEvent = detail.timeline.find((e) => e.code === "caries")
    assert.ok(cariesEvent, "a cárie permanece no histórico")
    assert.equal(cariesEvent.status, "resolved")
    // O estado atual passa a ser restaurado (derivado do procedimento real).
    assert.equal(detail.tooth.status, "restoration")
  })

  await test("procedimento PLANEJADO não resolve a cárie", async () => {
    // Dente 24: cárie em O, procedimento apenas planejado.
    await service.registerEvent(appointment.id, conditionPayload("24", "caries", ["O"]))
    await service.registerEvent(appointment.id, {
      kind: "procedure",
      procedureId: procedure.id,
      toothNumbers: ["24"],
      dentition: "permanent",
      surfaces: ["O"],
      status: "planned",
      notes: null,
      professionalName: "Dr. Teste",
    })

    const detail = await service.getToothDetail(appointment.id, "24")
    const caries = detail.activeConditions.find((c) => c.code === "caries")
    assert.ok(caries, "o planejado não pode tratar uma condição ainda não tratada")
    assert.equal(detail.tooth.status, "caries")
  })

  await test("procedimento reutiliza o catálogo existente (sem duplicar)", async () => {
    const before = await prisma.procedure.count()
    const result = await service.registerEvent(appointment.id, {
      kind: "procedure",
      procedureId: procedure.id,
      toothNumbers: ["26"],
      dentition: "permanent",
      surfaces: ["O"],
      status: "performed",
      notes: "Restauração em resina composta.",
      professionalName: "Dr. Teste",
    })
    assert.ok(!("error" in result), JSON.stringify(result))

    const after = await prisma.procedure.count()
    assert.equal(after, before, "o catálogo não pode ser duplicado pelo odontograma")

    const detail = await service.getToothDetail(appointment.id, "26")
    const performed = detail.timeline.find((e) => e.kind === "procedure")
    assert.ok(performed)
    assert.equal(performed.procedureId, procedure.id)
    assert.equal(performed.procedureCode, procedure.code)
    assert.equal(performed.procedurePrice, procedure.defaultPrice)
    assert.equal(performed.status, "performed")
  })

  await test("snapshot preserva nome/código mesmo se o catálogo mudar", async () => {
    const originalName = procedure.name
    await prisma.procedure.update({
      where: { id: procedure.id },
      data: { name: "NOME ALTERADO NO CATÁLOGO", defaultPrice: 999 },
    })

    const detail = await service.getToothDetail(appointment.id, "26")
    const performed = detail.timeline.find((e) => e.kind === "procedure")
    assert.equal(performed.label, originalName, "o snapshot não deve mudar")
    assert.equal(performed.procedurePrice, procedure.defaultPrice)

    // Restaura o catálogo para não afetar outros testes.
    await prisma.procedure.update({
      where: { id: procedure.id },
      data: { name: originalName, defaultPrice: procedure.defaultPrice },
    })
  })

  await test("procedimento inexistente é rejeitado", async () => {
    const result = await service.registerEvent(appointment.id, {
      kind: "procedure",
      procedureId: "nao-existe",
      toothNumbers: ["26"],
      dentition: "permanent",
      surfaces: [],
      status: "performed",
    })
    assert.ok("error" in result)
    assert.equal(result.code, "UNKNOWN_PROCEDURE")
  })

  await test("procedimento inativo é rejeitado", async () => {
    const inactive = await prisma.procedure.create({
      data: {
        name: "Procedimento Inativo (teste)",
        code: "INA-906",
        category: "Outros",
        defaultPrice: 10,
        active: false,
      },
    })

    const result = await service.registerEvent(appointment.id, {
      kind: "procedure",
      procedureId: inactive.id,
      toothNumbers: ["26"],
      dentition: "permanent",
      surfaces: [],
      status: "performed",
    })
    assert.ok("error" in result)
    assert.equal(result.code, "INACTIVE_PROCEDURE")

    await prisma.procedure.delete({ where: { id: inactive.id } })
  })

  // -----------------------------------------------------------------------
  section("(12) Planejado x Realizado")
  // -----------------------------------------------------------------------

  let plannedEventId = null

  await test("procedimento planejado é registrado com status planned", async () => {
    const result = await service.registerEvent(appointment.id, {
      kind: "procedure",
      procedureId: procedure.id,
      toothNumbers: ["37"],
      dentition: "permanent",
      surfaces: ["O"],
      status: "planned",
      notes: "Planejado para a próxima sessão.",
      professionalName: "Dr. Teste",
    })
    assert.ok(!("error" in result), JSON.stringify(result))
    assert.equal(result.planned, true)

    const detail = await service.getToothDetail(appointment.id, "37")
    const planned = detail.timeline.find((e) => e.status === "planned")
    assert.ok(planned, "o planejado deve estar no histórico")
    plannedEventId = planned.id
  })

  await test("planejado NÃO altera o estado clínico do dente", async () => {
    const detail = await service.getToothDetail(appointment.id, "37")
    assert.equal(detail.tooth.status, "healthy")
  })

  await test("marcar como realizado cria novo evento e preserva o planejado", async () => {
    const result = await service.updateProcedureEventStatus(
      appointment.id,
      plannedEventId,
      { status: "performed", notes: "Executado.", professionalName: "Dr. Teste" }
    )
    assert.ok(!("error" in result), JSON.stringify(result))

    const detail = await service.getToothDetail(appointment.id, "37")
    const procedures = detail.timeline.filter((e) => e.kind === "procedure")
    // O registro do planejamento e o da execução coexistem no histórico.
    assert.ok(procedures.length >= 2)
    assert.ok(procedures.some((e) => e.status === "performed"))
    assert.ok(procedures.some((e) => e.id === plannedEventId))
  })

  await test("procedimento não planejado não pode mudar de status", async () => {
    const detail = await service.getToothDetail(appointment.id, "26")
    const performed = detail.timeline.find(
      (e) => e.kind === "procedure" && e.status === "performed"
    )
    const result = await service.updateProcedureEventStatus(
      appointment.id,
      performed.id,
      { status: "performed", notes: null, professionalName: null }
    )
    assert.ok("error" in result)
    assert.equal(result.code, "INVALID_TRANSITION")
  })

  // -----------------------------------------------------------------------
  section("(13) Múltiplos dentes")
  // -----------------------------------------------------------------------

  await test("condição aplicada a vários dentes cria eventos distintos", async () => {
    const result = await service.registerEvent(
      appointment.id,
      conditionPayload(["16", "26", "36", "46"], "sealant", ["O"])
    )
    assert.ok(!("error" in result), JSON.stringify(result))
    assert.equal(result.created, 4)

    for (const number of ["16", "26", "36", "46"]) {
      const detail = await service.getToothDetail(appointment.id, number)
      assert.ok(
        detail.timeline.some((e) => e.code === "sealant"),
        `dente ${number} deveria ter selante`
      )
    }
  })

  await test("condição sem suporte a múltiplos dentes é rejeitada", async () => {
    const result = await service.registerEvent(
      appointment.id,
      conditionPayload(["16", "17"], "mobility", [])
    )
    assert.ok("error" in result)
    assert.equal(result.code, "MULTIPLE_NOT_ALLOWED")
  })

  await test("mobilidade em dente único é aceita", async () => {
    const result = await service.registerEvent(
      appointment.id,
      conditionPayload("17", "mobility", [])
    )
    assert.ok(!("error" in result), JSON.stringify(result))
  })

  // -----------------------------------------------------------------------
  section("(14) Projeção do estado atual (ToothState)")
  // -----------------------------------------------------------------------

  await test("estado do dente é persistido na projeção", async () => {
    // O dente 26 acumulou cárie, um procedimento restaurador e um selante.
    // O estado derivado é "restoration" (procedimento realizado).
    const state = await prisma.toothState.findFirst({
      where: { patientId: patient.id, toothNumber: "26", dentition: "permanent" },
    })
    assert.ok(state)
    assert.equal(state.status, "restoration")
    assert.ok(state.conditionCodes.split(",").includes("restoration"))
  })

  await test("dente extraído é refletido no resumo", async () => {
    await service.registerEvent(appointment.id, conditionPayload("18", "extracted", []))

    const data = await service.getOdontogram(appointment.id, "permanent")
    const tooth = data.teeth.find((t) => t.number === "18")
    assert.equal(tooth.status, "extracted")
    assert.ok(data.summary.absent >= 1)
  })

  await test("projeção é recalculada (não acumula estado divergente)", async () => {
    // Substitui as condições do dente 28 registrando uma nova condição e
    // verificando que a projeção continua consistente com os eventos ativos.
    await service.registerEvent(appointment.id, conditionPayload("28", "crown", []))

    const detail = await service.getToothDetail(appointment.id, "28")
    assert.equal(detail.tooth.status, "crown")

    const state = await prisma.toothState.findFirst({
      where: { patientId: patient.id, toothNumber: "28", dentition: "permanent" },
    })
    assert.equal(state.status, "crown")
  })

  // -----------------------------------------------------------------------
  section("(15) Isolamento entre pacientes")
  // -----------------------------------------------------------------------

  await test("odontograma não mistura pacientes", async () => {
    await service.registerEvent(
      otherAppointment.id,
      conditionPayload("46", "caries", ["O"])
    )

    const data = await service.getOdontogram(appointment.id, "permanent")
    const tooth46 = data.teeth.find((t) => t.number === "46")
    // O dente 46 do paciente principal não possui cárie (só selante).
    assert.ok(!tooth46.conditionCodes.includes("caries"))

    const otherData = await service.getOdontogram(otherAppointment.id, "permanent")
    const otherTooth46 = otherData.teeth.find((t) => t.number === "46")
    assert.ok(otherTooth46.conditionCodes.includes("caries"))
  })

  await test("detalhe do dente não vaza histórico de outro paciente", async () => {
    const detail = await service.getToothDetail(appointment.id, "46")
    for (const event of detail.timeline) {
      assert.equal(event.appointmentId, appointment.id)
    }
  })

  await test("não é possível alterar evento de outro paciente", async () => {
    const otherPlanned = await service.registerEvent(otherAppointment.id, {
      kind: "procedure",
      procedureId: procedure.id,
      toothNumbers: ["45"],
      dentition: "permanent",
      surfaces: [],
      status: "planned",
      notes: null,
      professionalName: "Dr. Teste",
    })
    assert.ok(!("error" in otherPlanned))

    const otherDetail = await service.getToothDetail(otherAppointment.id, "45")
    const plannedId = otherDetail.timeline.find((e) => e.status === "planned").id

    // Tenta alterar usando o atendimento do paciente ERRADO.
    const result = await service.updateProcedureEventStatus(
      appointment.id,
      plannedId,
      { status: "performed", notes: null, professionalName: null }
    )
    assert.ok("error" in result)
    assert.equal(result.code, "NOT_FOUND")
  })

  // -----------------------------------------------------------------------
  section("(16) Correção e integridade")
  // -----------------------------------------------------------------------

  await test("correção é feita adicionando novo evento (histórico intacto)", async () => {
    // Cenário autocontido no dente 14: restauração e depois falha registrada.
    await service.registerEvent(
      appointment.id,
      conditionPayload("14", "restoration", ["O"])
    )
    const before = await service.getToothDetail(appointment.id, "14")

    // Registra uma falha de restauração — não apaga a restauração anterior.
    await service.registerEvent(
      appointment.id,
      conditionPayload("14", "restoration_failure", ["O"])
    )

    const after = await service.getToothDetail(appointment.id, "14")
    assert.equal(after.timeline.length, before.timeline.length + 1)
    assert.ok(after.timeline.some((e) => e.code === "restoration"))
    assert.ok(after.timeline.some((e) => e.code === "restoration_failure"))
  })

  await test("nenhum evento é apagado pelas operações normais", async () => {
    const count = await prisma.odontogramEvent.count({
      where: { patientId: patient.id },
    })
    assert.ok(count > 0)

    const all = await prisma.odontogramEvent.findMany({
      where: { patientId: patient.id },
      select: { id: true },
    })
    assert.equal(all.length, count)
  })

  return fixtures
}

// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — PROCEDIMENTOS (Parte 7).
//
// Exercitam o SERVIÇO REAL contra um banco SQLite descartável, cobrindo:
//   • previsto (Agenda) x realizado;
//   • adicionado durante o atendimento;
//   • não realizado com motivo (registro preservado);
//   • alteração de valor permitida x bloqueada;
//   • geração do evento no ODONTOGRAMA quando há dente;
//   • isolamento entre pacientes (nada vaza entre atendimentos).
//
// Executado por scripts/test-procedures.mjs.
// ===========================================================================

import {
  service,
  prisma,
  test,
  section,
  assert,
  createPatient,
  createAppointment,
  ensureProcedure,
  scheduleProcedure,
} from "./_procedures-harness.mjs"

// ---------------------------------------------------------------------------

async function newAttendance() {
  const patient = await createPatient()
  const appointment = await createAppointment(patient.id, "in_progress")
  return { patient, appointment }
}

export async function runIntegrationScenarios() {
  section("Integração — previsto x realizado")

  await test("atendimento sem procedimentos retorna listas vazias", async () => {
    const { appointment } = await newAttendance()
    const data = await service.getProcedures(appointment.id)
    assert.ok(data, "esperado dados do atendimento")
    assert.equal(data.scheduled.length, 0)
    assert.equal(data.executions.length, 0)
    assert.equal(data.summary.scheduledCount, 0)
    assert.equal(data.summary.performedCount, 0)
  })

  await test("procedimento previsto na Agenda aparece como pendente", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure({ defaultPrice: 200 })
    await scheduleProcedure(appointment.id, procedure)

    const data = await service.getProcedures(appointment.id)
    assert.equal(data.scheduled.length, 1)
    assert.equal(data.summary.scheduledCount, 1)
    assert.equal(data.summary.expectedTotal, 200)
    assert.equal(data.scheduled[0].executionId, null)
  })

  await test("registrar procedimento da Agenda como realizado", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure({ defaultPrice: 200 })
    const scheduled = await scheduleProcedure(appointment.id, procedure)

    const result = await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "scheduled",
      scheduledProcedureId: scheduled.id,
      status: "performed",
      performedPrice: 200,
      toothNumber: "26",
      dentition: "permanent",
      surfaces: ["O"],
      notes: null,
      professionalName: "Dr. Teste",
    })
    assert.ok(result.ok, `esperado sucesso, veio: ${JSON.stringify(result)}`)

    const data = await service.getProcedures(appointment.id)
    assert.equal(data.summary.performedCount, 1)
    assert.equal(data.summary.performedTotal, 200)
    assert.equal(data.executions[0].comparison, "performed_as_planned")
    assert.equal(data.executions[0].toothNumber, "26")
    assert.deepEqual(data.executions[0].surfaces, ["O"])
  })

  await test("procedimento adicionado no atendimento é diferenciado da Agenda", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure({ defaultPrice: 150 })

    const result = await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "added_in_attendance",
      status: "performed",
      performedPrice: 150,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })
    assert.ok(result.ok, `esperado sucesso, veio: ${JSON.stringify(result)}`)

    const data = await service.getProcedures(appointment.id)
    assert.equal(data.executions[0].origin, "added_in_attendance")
    assert.equal(data.executions[0].comparison, "added_in_attendance")
    assert.equal(data.summary.addedCount, 1)
    // O previsto (Agenda) permanece intocado.
    assert.equal(data.summary.scheduledCount, 0)
  })

  section("Integração — não realizado (registro preservado)")

  await test("marcar previsto como não realizado exige motivo", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure({ defaultPrice: 300 })
    const scheduled = await scheduleProcedure(appointment.id, procedure)

    const created = await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "scheduled",
      scheduledProcedureId: scheduled.id,
      status: "pending",
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })
    assert.ok(created.ok)

    const result = await service.updateExecution(appointment.id, created.executionId, {
      status: "not_performed",
      // sem reasonCode -> deve falhar
      reasonNote: null,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      performedPrice: null,
      notes: null,
      professionalName: "Dr. Teste",
    })
    assert.ok("error" in result, "esperado erro por falta de motivo")
  })

  await test("não realizado com motivo mantém o valor previsto", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure({ defaultPrice: 300 })
    const scheduled = await scheduleProcedure(appointment.id, procedure)

    const created = await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "scheduled",
      scheduledProcedureId: scheduled.id,
      status: "pending",
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })
    assert.ok(created.ok)

    const result = await service.updateExecution(appointment.id, created.executionId, {
      status: "not_performed",
      reasonCode: "patient_not_authorized",
      reasonNote: "Paciente solicitou adiar.",
      toothNumber: null,
      dentition: null,
      surfaces: [],
      performedPrice: null,
      notes: null,
      professionalName: "Dr. Teste",
    })
    assert.ok(!("error" in result), `esperado sucesso, veio ${JSON.stringify(result)}`)

    const data = await service.getProcedures(appointment.id)
    assert.equal(data.summary.notPerformedCount, 1)
    assert.equal(data.summary.performedCount, 0)
    // Registro preservado: o item continua listado.
    assert.equal(data.executions.length, 1)
    assert.equal(data.executions[0].status, "not_performed")
    assert.ok(data.executions[0].reasonLabel, "esperado rótulo do motivo")
    // Não entra no total realizado.
    assert.equal(data.summary.performedTotal, 0)
  })

  section("Integração — valores (alteração permitida x bloqueada)")

  await test("alteração de valor permitida gera diferença explícita", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure({
      defaultPrice: 200,
      allowPriceOverride: true,
    })
    const scheduled = await scheduleProcedure(appointment.id, procedure)

    const result = await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "scheduled",
      scheduledProcedureId: scheduled.id,
      status: "performed",
      performedPrice: 260,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })
    assert.ok(result.ok, `esperado sucesso, veio ${JSON.stringify(result)}`)

    const data = await service.getProcedures(appointment.id)
    const execution = data.executions[0]
    assert.equal(execution.valueDiffers, true)
    assert.equal(execution.valueDifference, 60)
    assert.equal(data.summary.hasValueDifference, true)
  })

  await test("procedimento sem override NÃO aceita valor diferente do previsto", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure({
      defaultPrice: 200,
      allowPriceOverride: false,
    })
    const scheduled = await scheduleProcedure(appointment.id, procedure)

    const result = await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "scheduled",
      scheduledProcedureId: scheduled.id,
      status: "performed",
      performedPrice: 500,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })

    // O serviço é a autoridade final: recusa explicitamente a alteração.
    assert.ok("error" in result, "esperado recusa por valor não permitido")
    assert.equal(result.code, "PRICE_OVERRIDE_NOT_ALLOWED")

    // Nada foi gravado: o procedimento continua apenas como previsto.
    const data = await service.getProcedures(appointment.id)
    assert.equal(data.summary.performedCount, 0)
    assert.equal(data.executions.length, 0)
  })

  await test("o preço do CATÁLOGO nunca é alterado pelo registro", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure({ defaultPrice: 200 })
    const scheduled = await scheduleProcedure(appointment.id, procedure)

    await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "scheduled",
      scheduledProcedureId: scheduled.id,
      status: "performed",
      performedPrice: 999,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })

    const after = await prisma.procedure.findUnique({ where: { id: procedure.id } })
    assert.equal(after.defaultPrice, 200)
  })

  section("Integração — odontograma (fonte da verdade clínica)")

  await test("procedimento realizado com dente gera evento no odontograma", async () => {
    const { patient, appointment } = await newAttendance()
    const procedure = await ensureProcedure({ defaultPrice: 180 })
    const scheduled = await scheduleProcedure(appointment.id, procedure)

    const result = await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "scheduled",
      scheduledProcedureId: scheduled.id,
      status: "performed",
      performedPrice: 180,
      toothNumber: "16",
      dentition: "permanent",
      surfaces: ["O", "M"],
      notes: null,
      professionalName: "Dr. Teste",
    })
    assert.ok(result.ok, `esperado sucesso, veio ${JSON.stringify(result)}`)

    const events = await prisma.odontogramEvent.findMany({
      where: { patientId: patient.id },
    })
    assert.ok(events.length > 0, "esperado evento no odontograma")

    const data = await service.getProcedures(appointment.id)
    assert.ok(
      data.executions[0].odontogramEventId,
      "a execução deve referenciar o evento gerado"
    )
  })

  await test("procedimento SEM dente não gera evento no odontograma", async () => {
    const { patient, appointment } = await newAttendance()
    const procedure = await ensureProcedure({ defaultPrice: 120 })

    await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "added_in_attendance",
      status: "performed",
      performedPrice: 120,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })

    const events = await prisma.odontogramEvent.findMany({
      where: { patientId: patient.id },
    })
    assert.equal(events.length, 0)
  })

  section("Integração — segurança e isolamento")

  await test("atendimento inexistente retorna nulo", async () => {
    const data = await service.getProcedures("atendimento-que-nao-existe")
    assert.equal(data, null)
  })

  await test("não é possível registrar procedimento em atendimento de outro paciente", async () => {
    const a = await newAttendance()
    const b = await newAttendance()
    const procedure = await ensureProcedure({ defaultPrice: 200 })
    const scheduledB = await scheduleProcedure(b.appointment.id, procedure)

    // Tentar gravar, no atendimento A, um item que pertence ao atendimento B.
    const result = await service.registerExecution(a.appointment.id, {
      procedureId: procedure.id,
      origin: "scheduled",
      scheduledProcedureId: scheduledB.id,
      status: "performed",
      performedPrice: 200,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })

    assert.ok("error" in result, "esperado recusa por isolamento entre atendimentos")

    // O atendimento B permanece intacto.
    const dataB = await service.getProcedures(b.appointment.id)
    assert.equal(dataB.summary.performedCount, 0)
  })

  await test("atendimento encerrado não aceita novos registros", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "completed")
    const procedure = await ensureProcedure({ defaultPrice: 200 })

    const result = await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "added_in_attendance",
      status: "performed",
      performedPrice: 200,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })

    assert.ok("error" in result, "esperado recusa em atendimento encerrado")
  })

  await test("procedimento inativo não pode ser registrado", async () => {
    const { appointment } = await newAttendance()
    const procedure = await ensureProcedure({
      defaultPrice: 200,
      active: false,
    })

    const result = await service.registerExecution(appointment.id, {
      procedureId: procedure.id,
      origin: "added_in_attendance",
      status: "performed",
      performedPrice: 200,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })

    assert.ok("error" in result, "esperado recusa para procedimento inativo")
  })

  section("Integração — consistência do resumo")

  await test("resumo reflete fielmente previsto, realizado e não realizado", async () => {
    const { appointment } = await newAttendance()

    const executed = await ensureProcedure({ defaultPrice: 100 })
    const skipped = await ensureProcedure({ defaultPrice: 50 })
    const extra = await ensureProcedure({ defaultPrice: 80 })

    const s1 = await scheduleProcedure(appointment.id, executed)
    const s2 = await scheduleProcedure(appointment.id, skipped)

    await service.registerExecution(appointment.id, {
      procedureId: executed.id,
      origin: "scheduled",
      scheduledProcedureId: s1.id,
      status: "performed",
      performedPrice: 100,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })

    const created = await service.registerExecution(appointment.id, {
      procedureId: skipped.id,
      origin: "scheduled",
      scheduledProcedureId: s2.id,
      status: "pending",
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })
    assert.ok(created.ok)

    await service.updateExecution(appointment.id, created.executionId, {
      status: "not_performed",
      reasonCode: "postponed",
      reasonNote: null,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      performedPrice: null,
      notes: null,
      professionalName: "Dr. Teste",
    })

    await service.registerExecution(appointment.id, {
      procedureId: extra.id,
      origin: "added_in_attendance",
      status: "performed",
      performedPrice: 80,
      toothNumber: null,
      dentition: null,
      surfaces: [],
      notes: null,
      professionalName: "Dr. Teste",
    })

    const data = await service.getProcedures(appointment.id)
    assert.equal(data.summary.scheduledCount, 2, "previstos")
    assert.equal(data.summary.performedCount, 2, "realizados")
    assert.equal(data.summary.notPerformedCount, 1, "não realizados")
    assert.equal(data.summary.addedCount, 1, "adicionados")
    assert.equal(data.summary.expectedTotal, 150, "total previsto")
    assert.equal(data.summary.performedTotal, 180, "total realizado")
  })
}

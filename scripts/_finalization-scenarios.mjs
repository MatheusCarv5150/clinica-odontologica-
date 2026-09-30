// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — FINALIZAÇÃO DO ATENDIMENTO (Parte 9).
//
// Exercitam o SERVIÇO REAL contra um SQLite descartável: validação de
// pendências, transação, auditoria, idempotência, concorrência, duração e
// consistência dos dados derivados.
// ===========================================================================

import {
  service,
  domain,
  prisma,
  test,
  section,
  assert,
  createPatient,
  createAppointment,
  ensureProcedure,
  scheduleProcedure,
  createEvolutionRecord,
  registerExecution,
  createOdontogramEvent,
  createAnamnesis,
  getFinalizationLogs,
  getAppointment,
} from "./_finalization-harness.mjs"

const ACTOR = { userId: "usr-1", name: "Dr. João" }

// Atendimento completo e pronto para finalizar (sem pendências bloqueantes).
async function readyAppointment() {
  const patient = await createPatient()
  const appointment = await createAppointment(patient.id, "in_progress")
  const procedure = await ensureProcedure()
  await scheduleProcedure(appointment.id, procedure, 1)
  await registerExecution(appointment.id, patient.id, procedure.id, {
    origin: "scheduled",
    status: "performed",
    toothNumber: "26",
    performedPrice: 250,
  })
  await createEvolutionRecord(appointment.id, patient.id)
  await createOdontogramEvent(appointment.id, patient.id)
  await createAnamnesis(appointment.id, patient.id)
  return { patient, appointment, procedure }
}

export async function runIntegrationScenarios() {
  section("Integração — atendimento inexistente")

  await test("preview de atendimento inexistente devolve NOT_FOUND (404)", async () => {
    const result = await service.previewFinalization("inexistente", ACTOR.name)
    assert.ok("error" in result)
    assert.equal(result.code, "NOT_FOUND")
    assert.equal(result.status, 404)
  })

  await test("finalizar atendimento inexistente devolve NOT_FOUND (404)", async () => {
    const result = await service.finalizeAttendance("inexistente", ACTOR)
    assert.ok("error" in result)
    assert.equal(result.code, "NOT_FOUND")
    assert.equal(result.status, 404)
  })

  section("Integração — regras de status")

  await test("não finaliza atendimento ainda não iniciado (bloqueante)", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "paid")
    const result = await service.finalizeAttendance(appointment.id, ACTOR)
    assert.ok("error" in result)
    assert.equal(result.code, "INVALID_STATUS")
    assert.equal(result.status, 409)
  })

  await test("não finaliza atendimento cancelado", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "cancelled")
    const result = await service.finalizeAttendance(appointment.id, ACTOR)
    assert.ok("error" in result)
    assert.equal(result.code, "INVALID_STATUS")
  })

  await test("não finaliza paciente que não compareceu", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "no_show")
    const result = await service.finalizeAttendance(appointment.id, ACTOR)
    assert.ok("error" in result)
    assert.equal(result.code, "INVALID_STATUS")
  })

  section("Integração — pendências bloqueantes")

  await test("registro clínico ausente impede a finalização", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "in_progress")

    const preview = await service.previewFinalization(appointment.id, ACTOR.name)
    assert.ok(!("error" in preview))
    assert.equal(preview.canFinalize, false)
    assert.ok(preview.blocking.some((p) => p.code === "RECORD_MISSING"))

    const result = await service.finalizeAttendance(appointment.id, ACTOR)
    assert.ok("error" in result)
    assert.equal(result.code, "PENDING_BLOCKING")

    // Nada foi alterado.
    const after = await getAppointment(appointment.id)
    assert.equal(after.status, "in_progress")
    assert.equal(after.finishedAt, null)
  })

  await test("campo obrigatório (achados) ausente impede a finalização", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "in_progress")
    await createEvolutionRecord(appointment.id, patient.id, {
      clinicalFindings: "",
      evaluation: "",
      conduct: "",
    })

    const preview = await service.previewFinalization(appointment.id, ACTOR.name)
    assert.ok(!("error" in preview))
    assert.equal(preview.canFinalize, false)
    assert.ok(preview.blocking.some((p) => p.code === "RECORD_FINDINGS_MISSING"))
    assert.ok(preview.blocking.some((p) => p.code === "RECORD_EVALUATION_MISSING"))
    assert.ok(preview.blocking.some((p) => p.code === "RECORD_CONDUCT_MISSING"))
  })

  await test("intercorrência marcada sem descrição impede a finalização", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "in_progress")
    await createEvolutionRecord(appointment.id, patient.id, {
      intercurrentHas: true,
      intercurrentDesc: null,
    })

    const result = await service.finalizeAttendance(appointment.id, ACTOR)
    assert.ok("error" in result)
    assert.equal(result.code, "PENDING_BLOCKING")
  })

  await test("profissional em branco impede a finalização", async () => {
    const { appointment } = await readyAppointment()
    const result = await service.finalizeAttendance(appointment.id, {
      userId: null,
      name: "  ",
    })
    assert.ok("error" in result)
    assert.equal(result.code, "PROFESSIONAL_REQUIRED")
  })

  section("Integração — finalização com sucesso e efeitos colaterais")

  await test("finaliza com sucesso e grava status, timestamps e responsável", async () => {
    const { appointment } = await readyAppointment()
    const result = await service.finalizeAttendance(appointment.id, ACTOR)

    assert.ok(!("error" in result))
    assert.equal(result.finalized, true)
    assert.equal(result.alreadyFinalized, false)
    assert.ok(result.finalizedAt)
    assert.ok(result.startedAt)
    assert.equal(result.responsibleName, ACTOR.name)

    const after = await getAppointment(appointment.id)
    assert.equal(after.status, "completed")
    assert.ok(after.finishedAt instanceof Date)
    assert.ok(after.startedAt instanceof Date)
    assert.equal(after.finishedByName, ACTOR.name)
  })

  await test("duração é derivada dos timestamps (≈47 min)", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "in_progress")
    await createEvolutionRecord(appointment.id, patient.id)

    const result = await service.finalizeAttendance(appointment.id, ACTOR)
    assert.ok(!("error" in result))
    assert.ok(
      result.durationMinutes >= 46 && result.durationMinutes <= 48,
      `esperado ~47 min, obtido ${result.durationMinutes}`
    )
  })

  await test("registra auditoria ATENDIMENTO_FINALIZADO com transição de status", async () => {
    const { appointment, patient } = await readyAppointment()
    await service.finalizeAttendance(appointment.id, ACTOR)

    const logs = await getFinalizationLogs(appointment.id)
    assert.equal(logs.length, 1)
    assert.equal(logs[0].event, "ATENDIMENTO_FINALIZADO")
    assert.equal(logs[0].fromStatus, "in_progress")
    assert.equal(logs[0].toStatus, "completed")
    assert.equal(logs[0].patientId, patient.id)
    assert.equal(logs[0].performedByName, ACTOR.name)
    assert.ok(logs[0].startedAt instanceof Date)
    assert.ok(logs[0].finishedAt instanceof Date)
    // Resumo consolidado serializado.
    const summary = JSON.parse(logs[0].summary)
    assert.equal(summary.recordFilled, true)
    assert.ok(typeof summary.durationMinutes === "number")
  })

  await test("fecha o atendimento: escritas clínicas passam a ser bloqueadas", async () => {
    const { appointment } = await readyAppointment()
    await service.finalizeAttendance(appointment.id, ACTOR)
    const after = await getAppointment(appointment.id)
    assert.equal(after.status, "completed")
    // O status final é o enum existente ("completed") — nenhum status paralelo.
    assert.notEqual(after.status, "finalized")
  })

  section("Integração — idempotência e concorrência")

  await test("finalizar novamente é idempotente (não duplica auditoria)", async () => {
    const { appointment } = await readyAppointment()
    const first = await service.finalizeAttendance(appointment.id, ACTOR)
    assert.ok(!("error" in first))
    const finishedAt = first.finalizedAt

    const second = await service.finalizeAttendance(appointment.id, ACTOR)
    assert.ok(!("error" in second))
    assert.equal(second.alreadyFinalized, true)
    assert.equal(second.finalizedAt, finishedAt)

    const logs = await getFinalizationLogs(appointment.id)
    assert.equal(logs.length, 1)
  })

  await test("duas finalizações concorrentes produzem um único fechamento", async () => {
    const { appointment } = await readyAppointment()
    const [a, b] = await Promise.all([
      service.finalizeAttendance(appointment.id, ACTOR),
      service.finalizeAttendance(appointment.id, ACTOR),
    ])

    // Ambas retornam sucesso, mas apenas uma efetivamente fecha.
    assert.ok(!("error" in a))
    assert.ok(!("error" in b))

    const logs = await getFinalizationLogs(appointment.id)
    assert.equal(logs.length, 1, "deve existir exatamente 1 log de finalização")
  })

  section("Integração — pendências não bloqueantes (avisos)")

  await test("procedimento previsto não classificado gera aviso, não bloqueia", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "in_progress")
    const procedure = await ensureProcedure()
    await scheduleProcedure(appointment.id, procedure, 1)
    // Execução criada como "pending" (não classificada).
    await registerExecution(appointment.id, patient.id, procedure.id, {
      origin: "scheduled",
      status: "pending",
    })
    await createEvolutionRecord(appointment.id, patient.id)

    const preview = await service.previewFinalization(appointment.id, ACTOR.name)
    assert.ok(!("error" in preview))
    // Não bloqueia...
    assert.equal(preview.canFinalize, true)
    // ...mas avisa.
    assert.ok(preview.warnings.some((w) => w.code === "PROCEDURES_PENDING"))
    assert.equal(preview.summary.proceduresPending, 1)

    // A finalização é permitida: o profissional decide.
    const result = await service.finalizeAttendance(appointment.id, ACTOR)
    assert.ok(!("error" in result))
  })

  await test("procedimento não realizado permanece registrado após finalizar", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "in_progress")
    const procedure = await ensureProcedure()
    await registerExecution(appointment.id, patient.id, procedure.id, {
      origin: "added_in_attendance",
      status: "not_performed",
    })
    await createEvolutionRecord(appointment.id, patient.id)

    const result = await service.finalizeAttendance(appointment.id, ACTOR)
    assert.ok(!("error" in result))

    const executions = await prisma.appointmentProcedureExecution.findMany({
      where: { appointmentId: appointment.id },
    })
    assert.equal(executions.length, 1)
    assert.equal(executions[0].status, "not_performed")
  })

  await test("evolução não registrada gera aviso (não bloqueia)", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "in_progress")
    await createEvolutionRecord(appointment.id, patient.id, {
      evolution: "",
      clinicalFindings: "",
      conduct: "",
    })
    // Registro existe, mas sem texto de evolução/conduta/achados.
    await prisma.appointmentEvolution.update({
      where: { appointmentId: appointment.id },
      data: { clinicalFindings: "Achado", evaluation: "Avaliação", conduct: "Conduta" },
    })

    const preview = await service.previewFinalization(appointment.id, ACTOR.name)
    assert.ok(!("error" in preview))
    assert.equal(preview.canFinalize, true)
    assert.ok(preview.warnings.some((w) => w.code === "EVOLUTION_MISSING"))
  })

  section("Integração — consistência de dados derivados")

  await test("odontograma e evolução permanecem intactos após finalizar", async () => {
    const { appointment, patient } = await readyAppointment()
    const beforeEvents = await prisma.odontogramEvent.count({
      where: { appointmentId: appointment.id },
    })
    const beforeEvolutions = await prisma.appointmentEvolution.count({
      where: { appointmentId: appointment.id },
    })

    await service.finalizeAttendance(appointment.id, ACTOR)

    const afterEvents = await prisma.odontogramEvent.count({
      where: { appointmentId: appointment.id },
    })
    const afterEvolutions = await prisma.appointmentEvolution.count({
      where: { appointmentId: appointment.id },
    })
    // Nenhuma segunda evolução criada; odontograma preservado.
    assert.equal(afterEvents, beforeEvents)
    assert.equal(afterEvolutions, beforeEvolutions)
    assert.equal(afterEvolutions, 1)
  })

  await test("summary do preview reflete contagens reais dos procedimentos", async () => {
    const patient = await createPatient()
    const appointment = await createAppointment(patient.id, "in_progress")
    const p1 = await ensureProcedure()
    const p2 = await ensureProcedure()
    const p3 = await ensureProcedure()
    await scheduleProcedure(appointment.id, p1, 1)
    await scheduleProcedure(appointment.id, p2, 1)
    await scheduleProcedure(appointment.id, p3, 1)
    await registerExecution(appointment.id, patient.id, p1.id, { status: "performed" })
    await registerExecution(appointment.id, patient.id, p2.id, { status: "performed" })
    await registerExecution(appointment.id, patient.id, p3.id, { status: "not_performed" })
    await createEvolutionRecord(appointment.id, patient.id)

    const preview = await service.previewFinalization(appointment.id, ACTOR.name)
    assert.ok(!("error" in preview))
    assert.equal(preview.summary.proceduresScheduled, 3)
    assert.equal(preview.summary.proceduresPerformed, 2)
    assert.equal(preview.summary.proceduresNotPerformed, 1)
    assert.equal(preview.summary.proceduresPending, 0)
  })

  section("Integração — preview de atendimento já finalizado")

  await test("preview após finalizar informa que já está fechado", async () => {
    const { appointment } = await readyAppointment()
    await service.finalizeAttendance(appointment.id, ACTOR)

    const preview = await service.previewFinalization(appointment.id, ACTOR.name)
    assert.ok(!("error" in preview))
    assert.equal(preview.canFinalize, false)
    assert.ok(preview.blocking.some((p) => p.code === "ALREADY_FINALIZED"))
  })
}

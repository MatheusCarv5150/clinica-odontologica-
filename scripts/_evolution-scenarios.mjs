// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — EVOLUÇÃO CRONOLÓGICA (Parte 8).
//
// Exercitam o SERVIÇO REAL contra um SQLite descartável, criando registros
// pelas tabelas existentes (atendimento, registro clínico, procedimentos e
// odontograma) e verificando a projeção da linha do tempo.
// ===========================================================================

import {
  service,
  detailService,
  prisma,
  test,
  section,
  assert,
  createPatient,
  createAppointment,
  createProcedure,
  createEvolutionRecord,
  createExecution,
  createOdontogramEvent,
} from "./_evolution-harness.mjs"

const ALL = {
  period: "all",
  sort: "desc",
  page: 1,
  pageSize: 10,
  includeNonClinical: false,
}

export async function runIntegrationScenarios() {
  section("Integração — paciente não encontrado")

  await test("atendimento inexistente devolve null (404 na rota)", async () => {
    const result = await service.getEvolutionTimeline("atendimento-inexistente", ALL)
    assert.equal(result, null)
  })

  section("Integração — linha do tempo ordenada e agrupada")

  await test("evolução é ordenada do mais recente ao mais antigo", async () => {
    const patient = await createPatient("Paciente Ordenação")
    const older = await createAppointment(patient.id, {
      date: "2026-07-15",
      status: "completed",
    })
    const newer = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(older.id, patient.id, {
      evolution: "Avaliação de dor no dente 36.",
    })
    await createEvolutionRecord(newer.id, patient.id, {
      evolution: "Restauração concluída.",
    })
    // Atendimento atual (referência) — outro registro.
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    assert.ok(timeline)
    const dates = timeline.items.map((item) => item.date.split("T")[0])
    assert.deepEqual(dates, ["2026-09-10", "2026-07-15"])
  })

  await test("itens do mesmo dia são agrupados em uma única entrada", async () => {
    const patient = await createPatient("Paciente Agrupamento")
    const morning = await createAppointment(patient.id, {
      date: "2026-09-10",
      time: "09:00",
      status: "completed",
    })
    const afternoon = await createAppointment(patient.id, {
      date: "2026-09-10",
      time: "15:45",
      status: "completed",
    })
    await createEvolutionRecord(morning.id, patient.id, { evolution: "Avaliação." })
    await createEvolutionRecord(afternoon.id, patient.id, { evolution: "Procedimento." })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    assert.ok(timeline)
    assert.equal(timeline.groups.length, 1)
    assert.equal(timeline.groups[0].entries.length, 2)
    assert.equal(timeline.groups[0].dateKey, "2026-09-10")
  })

  section("Integração — atendimento atual separado do histórico")

  await test("atendimento atual é devolvido em bloco próprio e não duplicado", async () => {
    const patient = await createPatient("Paciente Atual")
    const past = await createAppointment(patient.id, {
      date: "2026-08-01",
      status: "completed",
    })
    await createEvolutionRecord(past.id, patient.id, { evolution: "Consulta anterior." })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    assert.ok(timeline)
    assert.ok(timeline.current)
    assert.equal(timeline.current.id, current.id)
    assert.equal(timeline.current.kind, "current")
    // O atual NÃO aparece na lista histórica.
    assert.ok(timeline.items.every((item) => item.id !== current.id))
  })

  await test("atendimento em andamento é destacado com status real", async () => {
    const patient = await createPatient("Paciente Em Andamento")
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })
    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    assert.ok(timeline?.current)
    assert.equal(timeline.current.status, "in_progress")
    assert.equal(timeline.current.isCurrent, true)
  })

  section("Integração — fontes reais (procedimentos e odontograma)")

  await test("procedimentos executados aparecem na evolução com dente", async () => {
    const patient = await createPatient("Paciente Procedimentos")
    const procedure = await createProcedure({ name: "Restauração em resina" })
    const past = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(past.id, patient.id)
    await createExecution(past.id, patient.id, procedure.id, {
      toothNumber: "26",
      surfaces: "O",
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    const entry = timeline?.items.find((item) => item.id === past.id)
    assert.ok(entry)
    assert.equal(entry.procedures.length, 1)
    assert.equal(entry.procedures[0].name, "Restauração em resina")
    assert.equal(entry.procedures[0].surfacesLabel, "Oclusal")
    assert.equal(entry.teeth[0].toothNumber, "26")
  })

  await test("procedimento apenas AGENDADO não aparece como realizado", async () => {
    const patient = await createPatient("Paciente Agendado")
    const procedure = await createProcedure()
    const past = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    // Item previsto na Agenda (AppointmentProcedure) — NÃO é execução.
    await prisma.appointmentProcedure.create({
      data: {
        appointmentId: past.id,
        procedureId: procedure.id,
        procedureNameSnapshot: procedure.name,
        unitPrice: 100,
        quantity: 1,
        totalPrice: 100,
      },
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    const entry = timeline?.items.find((item) => item.id === past.id)
    assert.ok(entry)
    assert.equal(entry.procedures.length, 0)
  })

  await test("execução cancelada não é contada como procedimento realizado", async () => {
    const patient = await createPatient("Paciente Cancelado Proc")
    const procedure = await createProcedure()
    const past = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createExecution(past.id, patient.id, procedure.id, {
      status: "cancelled",
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    const entry = timeline?.items.find((item) => item.id === past.id)
    assert.equal(entry.procedures.length, 0)
  })

  await test("eventos do odontograma aparecem com dente e superfície", async () => {
    const patient = await createPatient("Paciente Odontograma")
    const past = await createAppointment(patient.id, {
      date: "2026-09-05",
      status: "completed",
    })
    await createOdontogramEvent(past.id, patient.id, {
      toothNumber: "36",
      labelSnapshot: "Cárie",
      surfaces: "M",
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    const entry = timeline?.items.find((item) => item.id === past.id)
    assert.ok(entry)
    assert.equal(entry.toothEvents.length, 1)
    assert.equal(entry.toothEvents[0].surfacesLabel, "Mesial")
    assert.equal(entry.teeth[0].toothNumber, "36")
  })

  await test("queixa usa o registro clínico e cai para a anamnese quando vazio", async () => {
    const patient = await createPatient("Paciente Queixa")
    const withRecord = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(withRecord.id, patient.id, {
      chiefComplaint: "Dor no dente 26",
    })
    const withAnamnesis = await createAppointment(patient.id, {
      date: "2026-09-08",
      status: "completed",
    })
    await prisma.anamnesis.create({
      data: {
        appointmentId: withAnamnesis.id,
        patientId: patient.id,
        chiefComplaint: "Sensibilidade no dente 36",
      },
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    const recordEntry = timeline?.items.find((i) => i.id === withRecord.id)
    const anamnesisEntry = timeline?.items.find((i) => i.id === withAnamnesis.id)
    assert.equal(recordEntry.chiefComplaint, "Dor no dente 26")
    assert.equal(anamnesisEntry.chiefComplaint, "Sensibilidade no dente 36")
  })

  section("Integração — classificação dos registros")

  await test("registro finalizado é 'documented' e rascunho é 'draft'", async () => {
    const patient = await createPatient("Paciente Status")
    const done = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(done.id, patient.id, { finalized: true })
    const draft = await createAppointment(patient.id, {
      date: "2026-09-12",
      status: "in_progress",
    })
    await createEvolutionRecord(draft.id, patient.id, { finalized: false })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    assert.equal(
      timeline?.items.find((i) => i.id === done.id)?.kind,
      "documented",
    )
    assert.equal(
      timeline?.items.find((i) => i.id === draft.id)?.kind,
      "draft",
    )
  })

  await test("cancelado e não comparecimento ficam fora por padrão", async () => {
    const patient = await createPatient("Paciente Não Clínico")
    await createAppointment(patient.id, {
      date: "2026-09-01",
      status: "cancelled",
    })
    await createAppointment(patient.id, {
      date: "2026-09-02",
      status: "no_show",
    })
    const done = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(done.id, patient.id)
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    assert.equal(timeline?.items.length, 1)
    assert.equal(timeline?.items[0].id, done.id)
  })

  await test("itens não clínicos aparecem quando explicitamente incluídos", async () => {
    const patient = await createPatient("Paciente Incluir Não Clínico")
    const cancelled = await createAppointment(patient.id, {
      date: "2026-09-01",
      status: "cancelled",
    })
    const noShow = await createAppointment(patient.id, {
      date: "2026-09-02",
      status: "no_show",
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      includeNonClinical: true,
    })
    const kinds = timeline?.items.map((i) => i.kind) ?? []
    assert.ok(kinds.includes("cancelled"))
    assert.ok(kinds.includes("no_show"))
    assert.ok(timeline.items.some((i) => i.id === cancelled.id))
    assert.ok(timeline.items.some((i) => i.id === noShow.id))
  })

  section("Integração — isolamento entre pacientes (LGPD)")

  await test("evolução traz apenas atendimentos do próprio paciente", async () => {
    const patientA = await createPatient("Paciente A Isolamento")
    const patientB = await createPatient("Paciente B Isolamento")
    const aDone = await createAppointment(patientA.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(aDone.id, patientA.id)
    const bDone = await createAppointment(patientB.id, {
      date: "2026-09-11",
      status: "completed",
    })
    await createEvolutionRecord(bDone.id, patientB.id)
    const currentA = await createAppointment(patientA.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(currentA.id, ALL)
    assert.equal(timeline?.patient.id, patientA.id)
    assert.ok(timeline.items.every((i) => i.id === aDone.id))
    assert.ok(!timeline.items.some((i) => i.id === bDone.id))
  })

  await test("detalhe de atendimento de OUTRO paciente devolve 'not_found'", async () => {
    const patientA = await createPatient("Paciente A Detalhe")
    const patientB = await createPatient("Paciente B Detalhe")
    const currentA = await createAppointment(patientA.id, {
      date: "2026-09-19",
      status: "in_progress",
    })
    const bDone = await createAppointment(patientB.id, {
      date: "2026-09-11",
      status: "completed",
    })
    await createEvolutionRecord(bDone.id, patientB.id)

    const result = await detailService.getAttendanceDetail(currentA.id, bDone.id)
    assert.equal(result, "not_found")
  })

  await test("detalhe de atendimento do MESMO paciente é permitido", async () => {
    const patient = await createPatient("Paciente Detalhe OK")
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })
    const past = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(past.id, patient.id, {
      evolution: "Registro antigo.",
    })

    const result = await detailService.getAttendanceDetail(current.id, past.id)
    assert.notEqual(result, "not_found")
    assert.ok(typeof result === "object")
    assert.equal(result.attendance.readOnly, true)
    assert.equal(result.evolution?.evolution, "Registro antigo.")
  })

  await test("atendimento atual não é marcado como somente leitura", async () => {
    const patient = await createPatient("Paciente Leitura")
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const result = await detailService.getAttendanceDetail(current.id, current.id)
    assert.notEqual(result, "not_found")
    assert.ok(typeof result === "object")
    assert.equal(result.attendance.readOnly, false)
    assert.equal(result.attendance.isCurrent, true)
  })

  await test("atendimento concluído é somente leitura mesmo sendo o de referência", async () => {
    const patient = await createPatient("Paciente Concluído")
    const completed = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "completed",
    })
    const result = await detailService.getAttendanceDetail(completed.id, completed.id)
    assert.notEqual(result, "not_found")
    assert.ok(typeof result === "object")
    assert.equal(result.attendance.readOnly, true)
  })

  section("Integração — filtros e busca")

  await test("filtro por dente isola a evolução longitudinal do dente", async () => {
    const patient = await createPatient("Paciente Filtro Dente")
    const procedure = await createProcedure({ name: "Restauração" })
    const tooth26 = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createExecution(tooth26.id, patient.id, procedure.id, {
      toothNumber: "26",
      surfaces: "O",
    })
    const tooth36 = await createAppointment(patient.id, {
      date: "2026-09-08",
      status: "completed",
    })
    await createExecution(tooth36.id, patient.id, procedure.id, {
      toothNumber: "36",
      surfaces: "M",
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      tooth: "26",
    })
    assert.equal(timeline?.items.length, 1)
    assert.equal(timeline?.items[0].id, tooth26.id)
  })

  await test("filtro por dente também considera eventos do odontograma", async () => {
    const patient = await createPatient("Paciente Filtro Odontograma")
    const eventAppt = await createAppointment(patient.id, {
      date: "2026-09-05",
      status: "completed",
    })
    await createOdontogramEvent(eventAppt.id, patient.id, { toothNumber: "46" })
    const other = await createAppointment(patient.id, {
      date: "2026-09-06",
      status: "completed",
    })
    await createOdontogramEvent(other.id, patient.id, { toothNumber: "11" })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      tooth: "46",
    })
    assert.equal(timeline?.items.length, 1)
    assert.equal(timeline?.items[0].id, eventAppt.id)
  })

  await test("filtro por procedimento encontra atendimentos que o executaram", async () => {
    const patient = await createPatient("Paciente Filtro Procedimento")
    const restauracao = await createProcedure({ name: "Restauração filtro" })
    const profilaxia = await createProcedure({ name: "Profilaxia filtro" })
    const withRestauracao = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createExecution(withRestauracao.id, patient.id, restauracao.id)
    const withProfilaxia = await createAppointment(patient.id, {
      date: "2026-08-05",
      status: "completed",
    })
    await createExecution(withProfilaxia.id, patient.id, profilaxia.id)
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      procedure: restauracao.id,
    })
    assert.equal(timeline?.items.length, 1)
    assert.equal(timeline?.items[0].id, withRestauracao.id)
  })

  await test("filtro por profissional usa o rótulo real registrado", async () => {
    const patient = await createPatient("Paciente Filtro Profissional")
    const joao = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(joao.id, patient.id, {
      createdByName: "Dr. João da Silva",
      finalizedByName: "Dr. João da Silva",
    })
    const maria = await createAppointment(patient.id, {
      date: "2026-08-10",
      status: "completed",
    })
    await createEvolutionRecord(maria.id, patient.id, {
      createdByName: "Dra. Maria Souza",
      finalizedByName: "Dra. Maria Souza",
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      professional: "Dra. Maria Souza",
    })
    assert.equal(timeline?.items.length, 1)
    assert.equal(timeline?.items[0].id, maria.id)
    assert.equal(timeline?.items[0].professional?.name, "Dra. Maria Souza")
  })

  await test("busca textual encontra por queixa, conduta e procedimento", async () => {
    const patient = await createPatient("Paciente Busca")
    const procedure = await createProcedure({ name: "Extração busca" })
    const withText = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(withText.id, patient.id, {
      chiefComplaint: "Dor intensa no dente 26",
      conduct: "Realizada exodontia",
    })
    const withProcedure = await createAppointment(patient.id, {
      date: "2026-08-10",
      status: "completed",
    })
    await createExecution(withProcedure.id, patient.id, procedure.id, {
      name: "Extração busca",
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const byComplaint = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      query: "dor",
    })
    assert.equal(byComplaint?.items[0]?.id, withText.id)

    const byProcedure = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      query: "Extração",
    })
    assert.equal(byProcedure?.items.length, 1)
    assert.equal(byProcedure?.items[0].id, withProcedure.id)
  })

  await test("busca textual não encontra quando o termo não existe", async () => {
    const patient = await createPatient("Paciente Busca Vazia")
    const done = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(done.id, patient.id, {
      evolution: "Sem intercorrências.",
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      query: "termo-inexistente-xyz",
    })
    assert.equal(timeline?.items.length, 0)
  })

  await test("filtro de período restringe pela data do atendimento", async () => {
    const patient = await createPatient("Paciente Período")
    const old = await createAppointment(patient.id, {
      date: "2020-01-10",
      status: "completed",
    })
    await createEvolutionRecord(old.id, patient.id)
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      period: "1y",
    })
    assert.equal(timeline?.items.length, 0)
  })

  await test("ordenação ascendente é suportada", async () => {
    const patient = await createPatient("Paciente Asc")
    const older = await createAppointment(patient.id, {
      date: "2026-07-15",
      status: "completed",
    })
    await createEvolutionRecord(older.id, patient.id)
    const newer = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(newer.id, patient.id)
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      sort: "asc",
    })
    const dates = timeline?.items.map((i) => i.date.split("T")[0])
    assert.deepEqual(dates, ["2026-07-15", "2026-09-10"])
  })

  section("Integração — paginação e resumo")

  await test("paginação limita o número de atendimentos por página", async () => {
    const patient = await createPatient("Paciente Paginação")
    for (let i = 1; i <= 7; i++) {
      const appt = await createAppointment(patient.id, {
        date: `2026-08-${String(i).padStart(2, "0")}`,
        status: "completed",
      })
      await createEvolutionRecord(appt.id, patient.id)
    }
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const page1 = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      pageSize: 3,
    })
    assert.equal(page1?.items.length, 3)
    assert.equal(page1?.pagination.total, 7)
    assert.equal(page1?.pagination.totalPages, 3)
    assert.equal(page1?.pagination.hasMore, true)

    const page3 = await service.getEvolutionTimeline(current.id, {
      ...ALL,
      pageSize: 3,
      page: 3,
    })
    assert.equal(page3?.items.length, 1)
    assert.equal(page3?.pagination.hasMore, false)
  })

  await test("resumo agrega documentados, rascunhos e dentes tratados", async () => {
    const patient = await createPatient("Paciente Resumo")
    const procedure = await createProcedure()
    const documented = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(documented.id, patient.id, { finalized: true })
    await createExecution(documented.id, patient.id, procedure.id, {
      toothNumber: "26",
    })
    const draft = await createAppointment(patient.id, {
      date: "2026-09-12",
      status: "in_progress",
    })
    await createEvolutionRecord(draft.id, patient.id, { finalized: false })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    assert.equal(timeline?.summary.documented, 1)
    assert.equal(timeline?.summary.drafts, 1)
    assert.equal(timeline?.summary.teethTreated, 1)
    assert.equal(timeline?.summary.lastClinicalVisit, "2026-09-10")
  })

  await test("metadados de filtro listam apenas dados do próprio paciente", async () => {
    const patient = await createPatient("Paciente Metadados")
    const procedure = await createProcedure({ name: "Metadados proc" })
    const past = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createExecution(past.id, patient.id, procedure.id, {
      toothNumber: "26",
      professionalName: "Dr. João da Silva",
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    assert.equal(timeline?.filters.procedures.length, 1)
    assert.deepEqual(timeline?.filters.teeth, ["26"])
    assert.equal(timeline?.filters.professionals.length, 1)
    assert.equal(timeline?.filters.periods.length, 5)
  })

  await test("registro incompleto é identificado quando há procedimento sem registro", async () => {
    const patient = await createPatient("Paciente Incompleto")
    const procedure = await createProcedure()
    const incomplete = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createExecution(incomplete.id, patient.id, procedure.id)
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    const entry = timeline?.items.find((i) => i.id === incomplete.id)
    assert.equal(entry?.kind, "incomplete")
  })

  await test("intercorrência é exposta na evolução com descrição", async () => {
    const patient = await createPatient("Paciente Intercorrência")
    const past = await createAppointment(patient.id, {
      date: "2026-09-10",
      status: "completed",
    })
    await createEvolutionRecord(past.id, patient.id, {
      intercurrentHas: true,
      intercurrentDesc: "Paciente apresentou sensibilidade durante o procedimento.",
    })
    const current = await createAppointment(patient.id, {
      date: "2026-09-19",
      status: "in_progress",
    })

    const timeline = await service.getEvolutionTimeline(current.id, ALL)
    const entry = timeline?.items.find((i) => i.id === past.id)
    assert.equal(entry?.hasIntercurrent, true)
    assert.match(entry.intercurrentDescription, /sensibilidade/)
  })
}

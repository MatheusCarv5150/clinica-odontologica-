// ===========================================================================
// Cenários de integração da ANAMNESE (Parte 4).
//
// Separado do runner para manter cada arquivo legível. Importa o ambiente já
// preparado (serviço compilado + Prisma Client) de test-anamnesis.mjs.
// ===========================================================================

import {
  service,
  prisma,
  test,
  section,
  assert,
  clinical,
  session,
  item,
  structuredAnswer,
  createPatient,
  createAppointment,
} from "./_anamnesis-harness.mjs"

export async function runScenarios() {
  const patientA = await createPatient("Teste Anamnese A", "90500000001")
  const patientB = await createPatient("Teste Anamnese B", "90500000002")
  const apptA1 = await createAppointment(patientA.id, "2026-03-10T00:00:00.000Z")
  const apptA2 = await createAppointment(patientA.id, "2026-09-10T00:00:00.000Z")
  const apptB1 = await createAppointment(patientB.id, "2026-09-10T00:00:00.000Z")

  // -------------------------------------------------------------------------
  section("1. Primeira anamnese e estado vazio")

  await test("paciente novo retorna estado vazio, sem dado inventado", async () => {
    const data = await service.getAnamnesis(apptA1.id)
    assert.ok(data, "atendimento deveria ser resolvido")
    assert.equal(data.patient.id, patientA.id)
    assert.equal(data.hasAnyData, false)
    assert.equal(data.clinical.recordId, null)
    assert.equal(data.clinical.version, null)
    assert.deepEqual(data.clinical.answers, [])
    assert.deepEqual(data.clinical.allergies, [])
    assert.deepEqual(data.session.sessionAnswers, [])
    assert.equal(data.session.id, null)
    assert.equal(data.session.chiefComplaint, null)
    assert.deepEqual(data.alerts, [])
  })

  await test("atendimento inexistente é rejeitado (nunca cria registro órfão)", async () => {
    const data = await service.getAnamnesis("atendimento-que-nao-existe")
    assert.equal(data, null)
  })

  await test("primeira gravação cria a versão 1 do perfil clínico", async () => {
    const result = await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({ conditions: [item("condition", "Hipertensão")] }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dra. Ana",
    })
    assert.ok(result, "gravação deveria retornar resultado")
    assert.equal(result.clinicalVersion, 1)
    assert.ok(result.sessionId)
  })

  await test("dados gravados são lidos de volta íntegros", async () => {
    const data = await service.getAnamnesis(apptA1.id)
    assert.equal(data.hasAnyData, true)
    assert.equal(data.clinical.version, 1)
    assert.equal(data.clinical.conditions.length, 1)
    assert.equal(data.clinical.conditions[0].label, "Hipertensão")
    assert.equal(data.session.chiefComplaint, "Dor no dente 26")
    assert.equal(data.session.updatedByName, "Dra. Ana")
  })

  await test("o perfil clínico NÃO guarda a queixa do atendimento", async () => {
    const data = await service.getAnamnesis(apptA2.id)
    assert.equal(data.clinical.version, 1, "deve enxergar a versão vigente")
    assert.equal(data.session.chiefComplaint, null, "atendimento 2 ainda não tem queixa")
  })

  // -------------------------------------------------------------------------
  section("2. Queixa específica por atendimento")

  await test("gravar queixa no atendimento 2 não altera o atendimento 1", async () => {
    await service.saveAnamnesis(apptA2.id, {
      session: session({ chiefComplaint: "Consulta de rotina" }),
      responsibleName: "Dr. Bruno",
    })

    const first = await service.getAnamnesis(apptA1.id)
    const second = await service.getAnamnesis(apptA2.id)
    assert.equal(first.session.chiefComplaint, "Dor no dente 26")
    assert.equal(second.session.chiefComplaint, "Consulta de rotina")
    assert.notEqual(first.session.id, second.session.id)
  })

  await test("segunda consulta do mesmo paciente mantém o histórico clínico", async () => {
    const data = await service.getAnamnesis(apptA2.id)
    assert.equal(data.clinical.conditions[0].label, "Hipertensão")
  })

  await test("editar a queixa não cria nova versão do perfil clínico", async () => {
    const before = await service.getAnamnesis(apptA1.id)
    await service.saveAnamnesis(apptA1.id, {
      session: session({
        chiefComplaint: "Dor no dente 26",
        complaintHistory: "Começou há 3 dias, ao mastigar",
      }),
      responsibleName: "Dra. Ana",
    })
    const after = await service.getAnamnesis(apptA1.id)
    assert.equal(after.clinical.version, before.clinical.version, "não deve versionar")
    assert.equal(after.session.complaintHistory, "Começou há 3 dias, ao mastigar")
  })

  return { patientA, patientB, apptA1, apptA2, apptB1 }
}

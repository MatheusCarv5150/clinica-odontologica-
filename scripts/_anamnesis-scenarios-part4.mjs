// ===========================================================================
// Cenário 9 da ANAMNESE: as Partes anteriores continuam funcionando.
//
// Garante que a Parte 4 não recriou nem quebrou entidades existentes:
// o atendimento (Parte 3) segue único, o paciente segue o mesmo registro e o
// histórico de atendimentos continua consultável.
// ===========================================================================

import { prisma, test, section, assert } from "./_anamnesis-harness.mjs"

export async function runIntegrityScenarios({ patientA, apptA1, apptA2 }) {
  section("9. Partes anteriores continuam funcionando")

  await test("atendimento continua sendo a mesma entidade (sem duplicação)", async () => {
    const appt = await prisma.appointment.findUnique({
      where: { id: apptA1.id },
      select: { id: true, patientId: true },
    })
    assert.ok(appt, "atendimento da Parte 3 deve continuar existindo")
    assert.equal(appt.patientId, patientA.id)
  })

  await test("paciente continua sendo a mesma entidade", async () => {
    const patient = await prisma.patient.findUnique({
      where: { id: patientA.id },
      select: { fullName: true, cpf: true },
    })
    assert.equal(patient.cpf, "90500000001")
    assert.equal(patient.fullName, "Teste Anamnese A")
  })

  await test("histórico de atendimentos (Parte 3) permanece consultável", async () => {
    const appointments = await prisma.appointment.findMany({
      where: { patientId: patientA.id },
      orderBy: { appointmentDate: "asc" },
      select: { id: true },
    })
    assert.equal(appointments.length, 2)
    assert.equal(appointments[0].id, apptA1.id)
    assert.equal(appointments[1].id, apptA2.id)
  })

  await test("a anamnese não altera o status do atendimento", async () => {
    const appt = await prisma.appointment.findUnique({
      where: { id: apptA1.id },
      select: { status: true },
    })
    assert.equal(appt.status, "in_progress")
  })

  await test("nenhum dado cadastral do paciente é removido", async () => {
    const patient = await prisma.patient.findUnique({
      where: { id: patientA.id },
      select: { phone: true, birthDate: true },
    })
    assert.equal(patient.phone, "11999999999")
    assert.ok(patient.birthDate instanceof Date)
  })

  await test("a anamnese é anexada ao atendimento, não o substitui", async () => {
    const appt = await prisma.appointment.findUnique({
      where: { id: apptA1.id },
      include: { anamnesis: { select: { id: true, chiefComplaint: true } } },
    })
    assert.ok(appt.anamnesis, "anamnese deve estar vinculada ao atendimento")
    assert.equal(appt.anamnesis.chiefComplaint, "Dor no dente 26")
  })
}

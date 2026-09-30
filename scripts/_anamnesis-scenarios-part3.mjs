// ===========================================================================
// Cenários 6 a 8 da ANAMNESE: isolamento entre pacientes, alertas clínicos do
// cabeçalho e integridade/validação do que é persistido.
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

export async function runIsolationScenarios({ patientA, patientB, apptA1, apptB1 }) {
  // -------------------------------------------------------------------------
  section("6. Isolamento entre pacientes")

  await test("paciente B não recebe nenhum dado do paciente A", async () => {
    const data = await service.getAnamnesis(apptB1.id)
    assert.equal(data.patient.id, patientB.id)
    assert.equal(data.hasAnyData, false)
    assert.equal(data.clinical.version, null)
    assert.deepEqual(data.clinical.allergies, [])
    assert.deepEqual(data.alerts, [])
  })

  await test("gravar anamnese de B não afeta A", async () => {
    await service.saveAnamnesis(apptB1.id, {
      clinical: clinical({ allergies: [item("allergy", "Látex")] }),
      session: session({ chiefComplaint: "Sensibilidade no dente 11" }),
      responsibleName: "Dr. Bruno",
    })

    const dataA = await service.getAnamnesis(apptA1.id)
    const dataB = await service.getAnamnesis(apptB1.id)

    assert.equal(dataB.clinical.version, 1, "B começa na versão 1")
    assert.ok(
      dataA.clinical.allergies.every((a) => a.label !== "Látex"),
      "alergia de B não pode aparecer em A",
    )
    assert.ok(
      dataB.clinical.allergies.every((a) => a.label !== "Penicilina"),
      "alergia de A não pode aparecer em B",
    )
  })

  await test("histórico de B não inclui alterações de A", async () => {
    const historyB = await service.getAnamnesisHistory(apptB1.id)
    const names = historyB.entries.map((e) => e.changedByName)
    assert.ok(names.includes("Dr. Bruno"))
    assert.ok(
      historyB.entries.length < 10,
      `histórico de B contaminado: ${historyB.entries.length} entradas`,
    )
  })

  await test("o paciente é derivado do atendimento, não do cliente", async () => {
    const viaA = await service.resolveAttendance(apptA1.id)
    assert.equal(viaA.patientId, patientA.id)
    const viaB = await service.resolveAttendance(apptB1.id)
    assert.equal(viaB.patientId, patientB.id)
    assert.notEqual(viaA.patientId, viaB.patientId)
  })

  // -------------------------------------------------------------------------
  section("7. Alertas clínicos do cabeçalho")

  await test("alertas refletem apenas o paciente dono do atendimento", async () => {
    const alertsA = await service.getClinicalAlertsForAttendance(apptA1.id)
    assert.equal(alertsA.patientId, patientA.id)
    const textsA = alertsA.alerts.map((a) => a.text).join(" | ")
    assert.match(textsA, /Penicilina/)
    assert.ok(!textsA.includes("Látex"), "alerta de outro paciente vazou")

    const alertsB = await service.getClinicalAlertsForAttendance(apptB1.id)
    assert.equal(alertsB.patientId, patientB.id)
    assert.match(alertsB.alerts.map((a) => a.text).join(" | "), /Látex/)
  })

  await test("alertas incluem alergia e condição registradas", async () => {
    const alerts = await service.getClinicalAlertsForAttendance(apptA1.id)
    const kinds = new Set(alerts.alerts.map((a) => a.kind))
    assert.ok(kinds.has("allergy"), "alergia deve alertar")
    assert.ok(kinds.has("condition"), "condição deve alertar")
  })

  await test("medicamento ativo entra nos alertas do cabeçalho", async () => {
    const current = await service.getAnamnesis(apptA1.id)
    await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({
        allergies: current.clinical.allergies.map((a) => ({
          type: "allergy",
          label: a.label,
          reaction: a.reaction,
        })),
        conditions: current.clinical.conditions.map((c) => ({
          type: "condition",
          label: c.label,
        })),
        medications: [
          item("medication", "Warfarina", {
            dosage: "5mg",
            frequency: "uso contínuo",
            active: true,
          }),
        ],
      }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dra. Ana",
    })

    const alerts = await service.getClinicalAlertsForAttendance(apptA1.id)
    const medicationAlerts = alerts.alerts.filter((a) => a.kind === "medication")
    assert.ok(medicationAlerts.length > 0, "medicamento ativo deve alertar")
    assert.match(medicationAlerts.map((a) => a.text).join(" | "), /Warfarina/)
  })

  await test("medicamento suspenso não entra nos alertas do cabeçalho", async () => {
    const data = await service.getAnamnesis(apptA1.id)
    const suspended = data.clinical.medications.filter((m) => !m.active).map((m) => m.label)
    const alertTexts = (await service.getClinicalAlertsForAttendance(apptA1.id)).alerts.map(
      (a) => a.text,
    )
    for (const label of suspended) {
      assert.ok(
        !alertTexts.some((t) => t.includes(label)),
        `medicamento suspenso "${label}" não deveria alertar`,
      )
    }
  })

  await test("alertas não afirmam diagnóstico, apenas reportam o registro", async () => {
    const alerts = await service.getClinicalAlertsForAttendance(apptA1.id)
    const joined = alerts.alerts
      .map((a) => `${a.text} ${a.detail ?? ""}`)
      .join(" ")
      .toLowerCase()
    for (const forbidden of ["diagnostic", "suspeita de", "provavelmente", "recomenda-se"]) {
      assert.ok(!joined.includes(forbidden), `alerta contém juízo clínico: "${forbidden}"`)
    }
  })

  await test("atendimento sem dados não gera nenhum alerta", async () => {
    const patientC = await createPatient("Teste Anamnese C", "90500000003")
    const apptC = await createAppointment(patientC.id, "2026-09-11T00:00:00.000Z")
    const alerts = await service.getClinicalAlertsForAttendance(apptC.id)
    assert.deepEqual(alerts.alerts, [])

    await prisma.appointment.deleteMany({ where: { id: apptC.id } })
    await prisma.patient.deleteMany({ where: { id: patientC.id } })
  })

  await test("alertas de atendimento inexistente são nulos", async () => {
    const alerts = await service.getClinicalAlertsForAttendance("nao-existe")
    assert.equal(alerts, null)
  })

  // -------------------------------------------------------------------------
  section("8. Integridade e validação")

  await test("um atendimento tem no máximo uma anamnese (upsert, não duplica)", async () => {
    const count = await prisma.anamnesis.count({ where: { appointmentId: apptA1.id } })
    assert.equal(count, 1)
  })

  await test("respostas duplicadas na mesma versão são rejeitadas pelo banco", async () => {
    await assert.rejects(
      () =>
        prisma.anamnesisRecord.create({
          data: {
            patientId: patientB.id,
            version: 9901,
            scope: "patient",
            createdByName: "teste",
            answers: {
              create: [
                {
                  questionKey: "medical.cardiac",
                  section: "medical_history",
                  value: "yes",
                },
                {
                  questionKey: "medical.cardiac",
                  section: "medical_history",
                  value: "no",
                },
              ],
            },
          },
        }),
      /unique|constraint/i,
    )
  })

  await test("versão duplicada do mesmo paciente é rejeitada", async () => {
    await assert.rejects(
      () =>
        prisma.anamnesisRecord.create({
          data: {
            patientId: patientA.id,
            version: 1,
            scope: "patient",
            createdByName: "teste",
          },
        }),
      /unique|constraint/i,
    )
  })

  await test("valores gravados estão sempre no domínio yes/no/unknown", async () => {
    // Grava explicitamente respostas estruturadas para então verificar o domínio.
    const current = await service.getAnamnesis(apptA1.id)
    await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({
        answers: [structuredAnswer("medical.cardiac", "medical_history", "unknown")],
        allergies: current.clinical.allergies.map((a) => ({
          type: "allergy",
          label: a.label,
          reaction: a.reaction,
        })),
        conditions: current.clinical.conditions.map((c) => ({
          type: "condition",
          label: c.label,
        })),
      }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dra. Ana",
    })

    const data = await service.getAnamnesis(apptA1.id)
    assert.ok(data.clinical.answers.length > 0)
    for (const answer of data.clinical.answers) {
      assert.ok(
        ["yes", "no", "unknown"].includes(answer.value),
        `valor inválido encontrado: ${answer.value}`,
      )
    }
  })

  await test("respostas 'no' e 'unknown' permanecem distintas no banco", async () => {
    const current = await service.getAnamnesis(apptA1.id)
    const existingItem = {
      allergies: current.clinical.allergies.map((a) => ({
        type: "allergy",
        label: a.label,
        reaction: a.reaction,
      })),
      conditions: current.clinical.conditions.map((c) => ({
        type: "condition",
        label: c.label,
      })),
    }

    await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({
        ...existingItem,
        answers: [
          structuredAnswer("medical.cardiac", "medical_history", "unknown"),
          structuredAnswer("medical.diabetes", "medical_history", "no"),
        ],
      }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dra. Ana",
    })

    const data = await service.getAnamnesis(apptA1.id)
    const values = new Set(data.clinical.answers.map((a) => a.value))
    assert.ok(values.has("no"), "resposta 'não' deve existir")
    assert.ok(values.has("unknown"), "resposta 'não sabe' deve existir")
    assert.equal(values.size, 2, "os dois valores devem ser distintos")
  })

  await test("não é possível gravar anamnese em atendimento inexistente", async () => {
    const result = await service.saveAnamnesis("nao-existe", {
      session: session({ chiefComplaint: "fantasma" }),
      responsibleName: "Dra. Ana",
    })
    assert.equal(result, null)
    const orphans = await prisma.anamnesis.count({ where: { appointmentId: "nao-existe" } })
    assert.equal(orphans, 0)
  })

  await test("gravar sem enviar perfil clínico reaproveita a versão vigente", async () => {
    const before = await service.getAnamnesis(apptA1.id)
    await service.saveAnamnesis(apptA1.id, {
      session: session({ chiefComplaint: "Dor no dente 26", notes: "retorno" }),
      responsibleName: "Dra. Ana",
    })
    const after = await service.getAnamnesis(apptA1.id)
    assert.equal(
      after.clinical.version,
      before.clinical.version,
      "nenhuma versão nova deve ser criada",
    )
    assert.equal(after.clinical.recordId, before.clinical.recordId)
  })
}

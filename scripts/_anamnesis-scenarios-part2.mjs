// ===========================================================================
// Cenários 3 a 5 da ANAMNESE: perfil clínico permanente.
//
// Cobre alergias, medicamentos, condições, cirurgias, respostas estruturadas,
// versionamento append-only e a trilha de auditoria (quem/quando/antigo→novo).
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
} from "./_anamnesis-harness.mjs"

export async function runClinicalScenarios({ patientA, apptA1 }) {
  // -------------------------------------------------------------------------
  section("3. Alergias, medicamentos e condições")

  await test("registrar alergia com reação", async () => {
    await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({
        conditions: [item("condition", "Hipertensão")],
        allergies: [item("allergy", "Penicilina", { reaction: "urticária" })],
      }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dra. Ana",
    })

    const data = await service.getAnamnesis(apptA1.id)
    assert.equal(data.clinical.allergies.length, 1)
    assert.equal(data.clinical.allergies[0].label, "Penicilina")
    assert.equal(data.clinical.allergies[0].reaction, "urticária")
    assert.equal(data.clinical.version, 2, "alterar o perfil gera nova versão")
  })

  await test("registrar múltiplos medicamentos com dosagem e frequência", async () => {
    await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({
        conditions: [item("condition", "Hipertensão")],
        allergies: [item("allergy", "Penicilina", { reaction: "urticária" })],
        medications: [
          item("medication", "Losartana", {
            dosage: "50mg",
            frequency: "1x/dia",
            active: true,
          }),
          item("medication", "Varfarina", {
            dosage: "5mg",
            frequency: "uso contínuo",
            active: true,
          }),
        ],
      }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dra. Ana",
    })

    const data = await service.getAnamnesis(apptA1.id)
    assert.equal(data.clinical.medications.length, 2)
    assert.deepEqual(
      data.clinical.medications.map((m) => m.label).sort(),
      ["Losartana", "Varfarina"],
    )
  })

  await test("medicamento suspenso permanece no histórico marcado como inativo", async () => {
    await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({
        conditions: [item("condition", "Hipertensão")],
        allergies: [item("allergy", "Penicilina", { reaction: "urticária" })],
        medications: [
          item("medication", "Losartana", {
            dosage: "50mg",
            frequency: "1x/dia",
            active: false,
          }),
          item("medication", "Varfarina", {
            dosage: "5mg",
            frequency: "uso contínuo",
            active: true,
          }),
        ],
      }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dra. Ana",
    })

    const data = await service.getAnamnesis(apptA1.id)
    const losartana = data.clinical.medications.find((m) => m.label === "Losartana")
    assert.ok(losartana, "medicamento suspenso não pode ser apagado")
    assert.equal(losartana.active, false)
  })

  await test("registrar cirurgia com ano e motivo", async () => {
    const current = await service.getAnamnesis(apptA1.id)
    await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({
        conditions: current.clinical.conditions.map((c) => ({
          type: "condition",
          label: c.label,
        })),
        allergies: current.clinical.allergies.map((a) => ({
          type: "allergy",
          label: a.label,
          reaction: a.reaction,
        })),
        medications: current.clinical.medications.map((m) => ({
          type: "medication",
          label: m.label,
          dosage: m.dosage,
          frequency: m.frequency,
          active: m.active,
        })),
        surgeries: [item("surgery", "Apendicectomia", { year: "2015", reason: "apendicite" })],
      }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dra. Ana",
    })

    const data = await service.getAnamnesis(apptA1.id)
    assert.equal(data.clinical.surgeries.length, 1)
    assert.equal(data.clinical.surgeries[0].year, "2015")
    assert.equal(data.clinical.surgeries[0].reason, "apendicite")
  })

  await test("respostas estruturadas: 'não sabe' é diferente de 'não'", async () => {
    const current = await service.getAnamnesis(apptA1.id)
    await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({
        answers: [
          structuredAnswer("medical.cardiac", "medical_history", "unknown"),
          structuredAnswer("medical.diabetes", "medical_history", "no"),
        ],
        conditions: current.clinical.conditions.map((c) => ({
          type: "condition",
          label: c.label,
        })),
        allergies: current.clinical.allergies.map((a) => ({
          type: "allergy",
          label: a.label,
          reaction: a.reaction,
        })),
        medications: current.clinical.medications.map((m) => ({
          type: "medication",
          label: m.label,
          dosage: m.dosage,
          frequency: m.frequency,
          active: m.active,
        })),
        surgeries: current.clinical.surgeries.map((s) => ({
          type: "surgery",
          label: s.label,
          year: s.year,
          reason: s.reason,
        })),
      }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dra. Ana",
    })

    const data = await service.getAnamnesis(apptA1.id)
    const cardiac = data.clinical.answers.find((a) => a.questionKey === "medical.cardiac")
    const diabetes = data.clinical.answers.find((a) => a.questionKey === "medical.diabetes")
    assert.equal(cardiac.value, "unknown")
    assert.equal(diabetes.value, "no")
    assert.ok(cardiac.label.length > 0, "resposta deve trazer rótulo legível")
    assert.notEqual(cardiac.label, diabetes.label)
  })

  await test("a sessão aceita respostas estruturadas próprias", async () => {
    await service.saveAnamnesis(apptA1.id, {
      session: session({
        chiefComplaint: "Dor no dente 26",
        sessionAnswers: [
          structuredAnswer("dental.fear", "dental_history", "yes", "muito ansioso"),
        ],
      }),
      responsibleName: "Dra. Ana",
    })

    const data = await service.getAnamnesis(apptA1.id)
    assert.equal(data.session.sessionAnswers.length, 1)
    assert.equal(data.session.sessionAnswers[0].questionKey, "dental.fear")
    assert.equal(data.session.sessionAnswers[0].note, "muito ansioso")
  })

  await test("observações livres do perfil clínico são preservadas", async () => {
    const current = await service.getAnamnesis(apptA1.id)
    await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({
        conditions: current.clinical.conditions.map((c) => ({
          type: "condition",
          label: c.label,
        })),
        allergies: current.clinical.allergies.map((a) => ({
          type: "allergy",
          label: a.label,
          reaction: a.reaction,
        })),
        medications: current.clinical.medications.map((m) => ({
          type: "medication",
          label: m.label,
          dosage: m.dosage,
          frequency: m.frequency,
          active: m.active,
        })),
        surgeries: current.clinical.surgeries.map((s) => ({
          type: "surgery",
          label: s.label,
          year: s.year,
          reason: s.reason,
        })),
        notes: "Paciente relata boa saúde geral. Nega tabagismo.",
      }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dra. Ana",
    })

    const data = await service.getAnamnesis(apptA1.id)
    assert.equal(data.clinical.notes, "Paciente relata boa saúde geral. Nega tabagismo.")
  })

  // -------------------------------------------------------------------------
  section("4. Atualização preserva o histórico (append-only)")

  await test("atualizar gera NOVA versão, sem sobrescrever a anterior", async () => {
    const before = await service.getAnamnesis(apptA1.id)
    const versionBefore = before.clinical.version

    await service.saveAnamnesis(apptA1.id, {
      clinical: clinical({
        conditions: [item("condition", "Hipertensão"), item("condition", "Diabetes")],
        allergies: [item("allergy", "Penicilina", { reaction: "urticária" })],
        notes: "Paciente relatou melhora da dor.",
      }),
      session: session({ chiefComplaint: "Dor no dente 26" }),
      responsibleName: "Dr. Bruno",
    })

    const after = await service.getAnamnesis(apptA1.id)
    assert.equal(after.clinical.version, versionBefore + 1)
    assert.equal(after.clinical.notes, "Paciente relatou melhora da dor.")
    assert.equal(after.clinical.updatedByName, "Dr. Bruno")
    assert.equal(after.clinical.conditions.length, 2)
  })

  await test("todas as versões anteriores continuam no banco, em sequência", async () => {
    const versions = await prisma.anamnesisRecord.findMany({
      where: { patientId: patientA.id },
      orderBy: { version: "asc" },
      select: { version: true },
    })
    assert.ok(versions.length >= 4, `esperado >= 4 versões, obtido ${versions.length}`)
    versions.forEach((v, index) => {
      assert.equal(v.version, index + 1, "versões devem ser sequenciais e sem buracos")
    })
  })

  await test("a versão antiga mantém os valores que tinha na época", async () => {
    const v1 = await prisma.anamnesisRecord.findFirst({
      where: { patientId: patientA.id, version: 1 },
      include: { items: true },
    })
    assert.ok(v1, "versão 1 deve existir")
    assert.equal(v1.notes, null, "versão 1 não tinha observações")
    assert.deepEqual(
      v1.items.map((i) => i.label),
      ["Hipertensão"],
    )
  })

  await test("nenhum registro é apagado ao versionar", async () => {
    const total = await prisma.anamnesisRecord.count({ where: { patientId: patientA.id } })
    const latest = await prisma.anamnesisRecord.findFirst({
      where: { patientId: patientA.id },
      orderBy: { version: "desc" },
      select: { version: true },
    })
    assert.equal(total, latest.version, "nº de registros deve igualar a última versão")
  })

  await test("o responsável anterior permanece atribuído à sua versão", async () => {
    const v1 = await prisma.anamnesisRecord.findFirst({
      where: { patientId: patientA.id, version: 1 },
      select: { createdByName: true },
    })
    const latest = await prisma.anamnesisRecord.findFirst({
      where: { patientId: patientA.id },
      orderBy: { version: "desc" },
      select: { createdByName: true },
    })
    assert.equal(v1.createdByName, "Dra. Ana", "versão 1 continua atribuída à Dra. Ana")
    assert.equal(latest.createdByName, "Dr. Bruno")
  })

  // -------------------------------------------------------------------------
  section("5. Trilha de auditoria")

  await test("alteração registra quem, quando e o que mudou", async () => {
    const history = await service.getAnamnesisHistory(apptA1.id)
    assert.ok(history, "histórico deveria ser acessível")
    assert.ok(history.entries.length > 0, "deveria haver entradas de auditoria")
    assert.equal(history.hasAnyRecord, true)

    for (const entry of history.entries) {
      assert.ok(entry.changedAt, "toda entrada tem data/hora")
      assert.ok(entry.label, "toda entrada tem rótulo legível")
      assert.equal(entry.scope, "clinical")
    }
  })

  await test("auditoria guarda valor anterior E novo valor", async () => {
    const history = await service.getAnamnesisHistory(apptA1.id)
    const withBoth = history.entries.filter(
      (e) => e.oldValue !== null && e.newValue !== null,
    )
    assert.ok(
      withBoth.length > 0,
      "deveria existir alteração com valor anterior e novo registrados",
    )
  })

  await test("auditoria detecta inclusão de novo item (antigo vazio, novo preenchido)", async () => {
    const history = await service.getAnamnesisHistory(apptA1.id)
    const added = history.entries.filter((e) => e.oldValue === null && e.newValue !== null)
    assert.ok(added.length > 0, "inclusões devem aparecer na trilha")
  })

  await test("responsável pela alteração é registrado no log", async () => {
    const history = await service.getAnamnesisHistory(apptA1.id)
    const names = history.entries.map((e) => e.changedByName).filter(Boolean)
    assert.ok(names.includes("Dr. Bruno"), `nomes registrados: ${names.join(", ")}`)
  })

  await test("histórico é ordenado do mais recente para o mais antigo", async () => {
    const history = await service.getAnamnesisHistory(apptA1.id)
    const times = history.entries.map((e) => new Date(e.changedAt).getTime())
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i - 1] >= times[i], "entradas fora de ordem")
    }
  })

  await test("limite do histórico é respeitado, com teto de 300", async () => {
    const limited = await service.getAnamnesisHistory(apptA1.id, 2)
    assert.ok(limited.entries.length <= 2)
    const capped = await service.getAnamnesisHistory(apptA1.id, 9999)
    assert.ok(capped.entries.length <= 300, "limite máximo de 300 deve ser aplicado")
  })

  await test("histórico de atendimento inexistente é nulo", async () => {
    const history = await service.getAnamnesisHistory("nao-existe")
    assert.equal(history, null)
  })
}

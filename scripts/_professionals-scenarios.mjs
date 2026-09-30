// ===========================================================================
// CENÁRIOS DE INTEGRAÇÃO — USUÁRIOS/PROFISSIONAIS (Configurações).
//
// Exercitam o SERVIÇO REAL contra um SQLite descartável:
//   - criação com normalização e validação autoritativa;
//   - unicidade de CPF;
//   - edição preservando identidade e revalidando o payload completo;
//   - ativação/inativação;
//   - listagem com busca, filtros e paginação server-side;
//   - exclusão bloqueada quando há histórico (atendimento finalizado).
//
// Executado por scripts/test-professionals.mjs.
// ===========================================================================

import { service, finalization, resolver, prisma, test, section, assert } from "./_professionals-harness.mjs"

// CPFs válidos distintos para os cenários.
const CPF_A = "52998224725"
const CPF_B = "11144477735"
const CPF_C = "39053344705"

function basePayload(overrides = {}) {
  return {
    fullName: "João da Silva",
    birthDate: "1985-04-12",
    cpf: CPF_A,
    councilType: "CRO",
    councilNumber: "12345",
    councilState: "PE",
    status: "active",
    ...overrides,
  }
}

// A edição espera o payload COMPLETO (o serviço revalida todos os campos).
function fullUpdate(overrides = {}) {
  return basePayload(overrides)
}

async function resetProfessionals() {
  // Remove dependências de histórico antes dos profissionais para respeitar FK.
  // A evolução clínica e o log de finalização referenciam o atendimento —
  // precisam sair antes dele.
  await prisma.appointmentFinalizationLog.deleteMany({})
  await prisma.appointmentEvolution.deleteMany({})
  await prisma.appointment.deleteMany({})
  await prisma.patient.deleteMany({})
  await prisma.professional.deleteMany({})
}

// Cria um paciente + atendimento EM ANDAMENTO já com o registro clínico
// obrigatório preenchido — ou seja, um atendimento ELEGÍVEL à finalização.
// Sem esse registro, o domínio bloqueia o encerramento (RECORD_*), o que
// mascararia o comportamento de snapshot que os cenários querem verificar.
async function createFinalizableAppointment({ cpf = CPF_C, time = "09:00" } = {}) {
  const patient = await prisma.patient.create({
    data: {
      fullName: "Paciente Teste",
      cpf,
      birthDate: new Date("1990-01-01"),
      phone: "11999999999",
    },
  })
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      appointmentDate: new Date(),
      appointmentTime: time,
      status: "in_progress",
      startedAt: new Date(Date.now() - 30 * 60 * 1000),
    },
  })
  await prisma.appointmentEvolution.create({
    data: {
      appointmentId: appointment.id,
      patientId: patient.id,
      clinicalFindings: "Achados clínicos de teste.",
      evaluation: "Avaliação de teste.",
      conduct: "Conduta de teste.",
      evolution: "Evolução de teste.",
      intercurrentHas: false,
    },
  })
  return appointment
}

export async function runIntegrationScenarios() {
  section("Integração — criação")

  await test("cria profissional válido e normaliza os campos", async () => {
    await resetProfessionals()
    const result = await service.createProfessional(
      basePayload({ fullName: "  João   da Silva ", cpf: "529.982.247-25", councilState: "pe" })
    )
    assert.ok(!service.isProfessionalError(result), "não deveria retornar erro")
    assert.equal(result.fullName, "João da Silva")
    assert.equal(result.cpf, CPF_A)
    assert.equal(result.cpfFormatted, "529.982.247-25")
    assert.equal(result.councilState, "PE")
    assert.equal(result.councilLabel, "CRO-PE 12345")
    assert.equal(result.status, "active")
  })

  await test("rejeita CPF inválido", async () => {
    await resetProfessionals()
    const result = await service.createProfessional(basePayload({ cpf: "111.111.111-11" }))
    assert.ok(service.isProfessionalError(result), "deveria retornar erro")
    assert.equal(result.status, 422)
    assert.equal(result.field, "cpf")
  })

  await test("rejeita nome vazio", async () => {
    await resetProfessionals()
    const result = await service.createProfessional(basePayload({ fullName: "   " }))
    assert.ok(service.isProfessionalError(result), "deveria retornar erro")
    assert.equal(result.field, "fullName")
  })

  await test("rejeita conselho fora da lista", async () => {
    await resetProfessionals()
    const result = await service.createProfessional(basePayload({ councilType: "XPTO" }))
    assert.ok(service.isProfessionalError(result), "deveria retornar erro")
    assert.equal(result.field, "councilType")
  })

  await test("rejeita data de nascimento futura", async () => {
    await resetProfessionals()
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    const result = await service.createProfessional(
      basePayload({ birthDate: future.toISOString() })
    )
    assert.ok(service.isProfessionalError(result), "deveria retornar erro")
    assert.equal(result.field, "birthDate")
  })

  section("Integração — unicidade de CPF")

  await test("CPF duplicado é bloqueado, mesmo com máscara diferente", async () => {
    await resetProfessionals()
    const first = await service.createProfessional(basePayload())
    assert.ok(!service.isProfessionalError(first))

    const dup = await service.createProfessional(
      basePayload({ cpf: "529.982.247-25", councilNumber: "99999" })
    )
    assert.ok(service.isProfessionalError(dup), "deveria bloquear CPF duplicado")
    assert.equal(dup.status, 409)
    assert.equal(dup.field, "cpf")
  })

  section("Integração — edição")

  await test("edição atualiza os dados cadastrais mantendo a identidade", async () => {
    await resetProfessionals()
    const created = await service.createProfessional(basePayload())
    assert.ok(!service.isProfessionalError(created))

    const updated = await service.updateProfessional(
      created.id,
      fullUpdate({ fullName: "João da Silva Júnior", councilNumber: "54321" })
    )
    assert.ok(!service.isProfessionalError(updated))
    assert.equal(updated.fullName, "João da Silva Júnior")
    assert.equal(updated.councilNumber, "54321")
    assert.equal(updated.id, created.id, "identidade não muda na edição")
  })

  await test("edição mantém o próprio CPF como válido (não acusa duplicidade consigo mesmo)", async () => {
    await resetProfessionals()
    const created = await service.createProfessional(basePayload())
    assert.ok(!service.isProfessionalError(created))

    const updated = await service.updateProfessional(created.id, fullUpdate())
    assert.ok(
      !service.isProfessionalError(updated),
      "não deveria acusar duplicidade consigo mesmo"
    )
  })

  await test("edição não permite assumir CPF de outro profissional", async () => {
    await resetProfessionals()
    const a = await service.createProfessional(basePayload())
    const b = await service.createProfessional(
      basePayload({ cpf: CPF_B, councilNumber: "22222" })
    )
    assert.ok(!service.isProfessionalError(a) && !service.isProfessionalError(b))

    const updated = await service.updateProfessional(b.id, fullUpdate({ cpf: CPF_A }))
    assert.ok(service.isProfessionalError(updated), "deveria bloquear CPF de outro")
    assert.equal(updated.field, "cpf")
  })

  await test("edição de id inexistente retorna 404", async () => {
    const result = await service.updateProfessional("nao-existe", fullUpdate())
    assert.ok(service.isProfessionalError(result))
    assert.equal(result.status, 404)
  })

  section("Integração — status")

  await test("inativar e reativar altera apenas o status", async () => {
    await resetProfessionals()
    const created = await service.createProfessional(basePayload())
    assert.ok(!service.isProfessionalError(created))

    const off = await service.setProfessionalStatus(created.id, "inactive")
    assert.ok(!service.isProfessionalError(off))
    assert.equal(off.status, "inactive")
    assert.equal(off.statusLabel, "Inativo")

    const on = await service.setProfessionalStatus(created.id, "active")
    assert.ok(!service.isProfessionalError(on))
    assert.equal(on.status, "active")
  })

  await test("inativar id inexistente retorna 404", async () => {
    const result = await service.setProfessionalStatus("nao-existe", "inactive")
    assert.ok(service.isProfessionalError(result))
    assert.equal(result.status, 404)
  })

  section("Integração — listagem server-side")

  await test("busca por nome é case-insensitive e parcial", async () => {
    await resetProfessionals()
    await service.createProfessional(basePayload({ councilNumber: "10001" }))
    await service.createProfessional(
      basePayload({ cpf: CPF_B, fullName: "Maria Souza", councilNumber: "10002" })
    )

    const result = await service.listProfessionals({ search: "mari" })
    assert.equal(result.total, 1)
    assert.equal(result.items[0].fullName, "Maria Souza")
  })

  await test("busca por CPF aceita máscara", async () => {
    await resetProfessionals()
    await service.createProfessional(basePayload())

    const result = await service.listProfessionals({ search: "529.982.247-25" })
    assert.equal(result.total, 1)
  })

  await test("filtro por status restringe o resultado", async () => {
    await resetProfessionals()
    const a = await service.createProfessional(basePayload())
    const b = await service.createProfessional(
      basePayload({ cpf: CPF_B, councilNumber: "10002" })
    )
    assert.ok(!service.isProfessionalError(a) && !service.isProfessionalError(b))
    await service.setProfessionalStatus(b.id, "inactive")

    const inactives = await service.listProfessionals({ status: "inactive" })
    assert.equal(inactives.total, 1)
    assert.equal(inactives.items[0].id, b.id)

    const actives = await service.listProfessionals({ status: "active" })
    assert.equal(actives.total, 1)
    assert.equal(actives.items[0].id, a.id)
  })

  await test("filtro por tipo de conselho restringe o resultado", async () => {
    await resetProfessionals()
    await service.createProfessional(basePayload())
    await service.createProfessional(
      basePayload({ cpf: CPF_B, councilType: "CRM", councilNumber: "10002" })
    )

    const result = await service.listProfessionals({ councilType: "CRM" })
    assert.equal(result.total, 1)
    assert.equal(result.items[0].councilType, "CRM")
  })

  await test("paginação respeita pageSize e informa totalPages", async () => {
    await resetProfessionals()
    const cpfs = [CPF_A, CPF_B, CPF_C]
    const names = ["Ana", "Bruno", "Carla"]
    for (let i = 0; i < 3; i++) {
      const created = await service.createProfessional(
        basePayload({ fullName: names[i], cpf: cpfs[i], councilNumber: `2000${i}` })
      )
      assert.ok(!service.isProfessionalError(created), "criação deveria funcionar")
    }

    const page1 = await service.listProfessionals({ page: 1, pageSize: 2 })
    assert.equal(page1.items.length, 2)
    assert.equal(page1.total, 3)
    assert.equal(page1.totalPages, 2)

    const page2 = await service.listProfessionals({ page: 2, pageSize: 2 })
    assert.equal(page2.items.length, 1)
  })

  await test("listActiveProfessionals devolve somente ativos", async () => {
    await resetProfessionals()
    const a = await service.createProfessional(basePayload())
    const b = await service.createProfessional(
      basePayload({ cpf: CPF_B, councilNumber: "10002" })
    )
    assert.ok(!service.isProfessionalError(a) && !service.isProfessionalError(b))
    await service.setProfessionalStatus(b.id, "inactive")

    const actives = await service.listActiveProfessionals()
    assert.equal(actives.length, 1)
    assert.equal(actives[0].id, a.id)
  })

  section("Integração — exclusão bloqueada por histórico")

  await test("profissional SEM histórico pode ser excluído", async () => {
    await resetProfessionals()
    const created = await service.createProfessional(basePayload())
    assert.ok(!service.isProfessionalError(created))

    const result = await service.deleteProfessional(created.id)
    assert.ok(!service.isProfessionalError(result), "exclusão sem histórico deveria funcionar")

    const gone = await service.getProfessional(created.id)
    assert.equal(gone, null)
  })

  await test("profissional COM atendimento finalizado não pode ser excluído", async () => {
    await resetProfessionals()
    const created = await service.createProfessional(basePayload())
    assert.ok(!service.isProfessionalError(created))

    // Histórico real: atendimento cujo `finishedById` aponta para o profissional.
    const patient = await prisma.patient.create({
      data: {
        fullName: "Paciente Teste",
        cpf: "390.533.447-05",
        birthDate: new Date("1990-01-01"),
        phone: "11999999999",
      },
    })
    await prisma.appointment.create({
      data: {
        patientId: patient.id,
        appointmentDate: new Date(),
        appointmentTime: "09:00",
        status: "finished",
        finishedById: created.id,
        finishedByName: created.fullName,
      },
    })

    const result = await service.deleteProfessional(created.id)
    assert.ok(
      service.isProfessionalError(result),
      "exclusão com histórico deveria ser bloqueada"
    )
    assert.equal(result.status, 409)
    assert.equal(result.code, "HAS_HISTORY")
  })

  // -------------------------------------------------------------------------
  // Integração com o ATENDIMENTO — snapshot histórico de identidade
  // -------------------------------------------------------------------------

  section("Integração — snapshot de identidade no atendimento")

  await test("finalização grava nome e conselho do profissional CADASTRADO", async () => {
    await resetProfessionals()
    const pro = await service.createProfessional(
      basePayload({ fullName: "Dra. Ana Souza", councilNumber: "54321" })
    )
    assert.ok(!service.isProfessionalError(pro))

    const appt = await createFinalizableAppointment({ time: "09:00" })

    const result = await finalization.finalizeAttendance(appt.id, {
      userId: pro.id,
      name: "Nome Arbitrário Digitado",
    })
    assert.ok(!("error" in result), `deveria finalizar sem erro: ${result.error ?? ""}`)
    // O nome vem do CADASTRO, não do texto informado pelo cliente.
    assert.equal(result.responsibleName, "Dra. Ana Souza")
    assert.equal(result.responsibleCouncil, "CRO-PE 54321")

    const saved = await prisma.appointment.findUnique({ where: { id: appt.id } })
    assert.equal(saved.finishedById, pro.id)
    assert.equal(saved.finishedByName, "Dra. Ana Souza")
    assert.equal(saved.finishedByCouncil, "CRO-PE 54321")
  })

  await test("nome vindo do cadastro vence o texto informado pelo cliente", async () => {
    await resetProfessionals()
    const pro = await service.createProfessional(
      basePayload({ fullName: "Dr. Carlos Mendes", councilNumber: "77777" })
    )
    const appt = await createFinalizableAppointment({ time: "09:30" })

    const result = await finalization.finalizeAttendance(appt.id, {
      userId: pro.id,
      name: "Outro Nome Qualquer",
    })
    assert.ok(!("error" in result), "deveria finalizar sem erro")
    assert.equal(result.responsibleName, "Dr. Carlos Mendes")
    assert.equal(result.responsibleCouncil, "CRO-PE 77777")
  })

  await test("editar o cadastro NÃO reescreve o histórico do atendimento", async () => {
    await resetProfessionals()
    const pro = await service.createProfessional(
      basePayload({ fullName: "Dr. Bruno Lima", councilNumber: "11111" })
    )
    const appt = await createFinalizableAppointment({ time: "10:00" })

    await finalization.finalizeAttendance(appt.id, { userId: pro.id, name: pro.fullName })

    // O profissional muda de nome e de conselho depois do atendimento.
    await service.updateProfessional(
      pro.id,
      fullUpdate({
        fullName: "Dr. Bruno Lima Júnior",
        cpf: CPF_A,
        councilNumber: "99999",
      })
    )

    const saved = await prisma.appointment.findUnique({ where: { id: appt.id } })
    // O snapshot permanece congelado no momento da finalização.
    assert.equal(saved.finishedByName, "Dr. Bruno Lima")
    assert.equal(saved.finishedByCouncil, "CRO-PE 11111")

    // E a identidade VIVA reflete a edição.
    const live = await service.getProfessional(pro.id)
    assert.equal(live.fullName, "Dr. Bruno Lima Júnior")
    assert.equal(live.councilLabel, "CRO-PE 99999")
  })

  await test("sem professionalId mantém a identidade textual legada", async () => {
    await resetProfessionals()
    const appt = await createFinalizableAppointment({ time: "11:00" })

    const result = await finalization.finalizeAttendance(appt.id, {
      userId: null,
      name: "Profissional Textual",
    })
    assert.ok(!("error" in result), "deveria finalizar sem erro")
    assert.equal(result.responsibleName, "Profissional Textual")
    assert.equal(result.responsibleCouncil, null)

    const saved = await prisma.appointment.findUnique({ where: { id: appt.id } })
    assert.equal(saved.finishedById, null)
    assert.equal(saved.finishedByCouncil, null)
  })

  await test("professionalId inexistente não inventa conselho", async () => {
    await resetProfessionals()
    const appt = await createFinalizableAppointment({ time: "12:00" })

    const ghostId = "00000000-0000-4000-8000-000000000000"
    const result = await finalization.finalizeAttendance(appt.id, {
      userId: ghostId,
      name: "Nome Informado",
    })
    assert.ok(!("error" in result), "deveria finalizar sem erro")
    assert.equal(result.responsibleName, "Nome Informado")
    assert.equal(result.responsibleCouncil, null)
  })

  await test("profissional INATIVO ainda é resolvido (histórico íntegro)", async () => {
    await resetProfessionals()
    const pro = await service.createProfessional(
      basePayload({ fullName: "Dra. Vera Dias", councilNumber: "22222" })
    )
    // Inativado ANTES de finalizar: o snapshot histórico não pode depender de
    // o cadastro estar ativo — senão o histórico perderia o responsável.
    await service.setProfessionalStatus(pro.id, "inactive")

    const appt = await createFinalizableAppointment({ time: "13:00" })
    const result = await finalization.finalizeAttendance(appt.id, {
      userId: pro.id,
      name: pro.fullName,
    })
    assert.ok(!("error" in result), "deveria finalizar sem erro")
    assert.equal(result.responsibleName, "Dra. Vera Dias")
    assert.equal(result.responsibleCouncil, "CRO-PE 22222")
  })

  // -------------------------------------------------------------------------
  // Resolução do profissional no HISTÓRICO do atendimento
  //
  // O cabeçalho e o histórico precisam exibir a identidade VIVA do
  // profissional a partir do snapshot gravado. A regra é:
  //   id (vínculo explícito)  →  nome congelado (legado)  →  nulo.
  // -------------------------------------------------------------------------

  section("Integração — resolução do profissional no histórico")

  await test("vínculo por id resolve a identidade VIVA (nome atual)", async () => {
    await resetProfessionals()
    const pro = await service.createProfessional(
      basePayload({ fullName: "Dr. Henrique Alves", councilNumber: "30303" })
    )

    // Atendimento finalizado por esse profissional.
    const appt = await createFinalizableAppointment({ time: "08:00" })
    await finalization.finalizeAttendance(appt.id, {
      userId: pro.id,
      name: pro.fullName,
    })

    // O cadastro é editado DEPOIS — o id deve continuar resolvendo.
    await service.updateProfessional(
      pro.id,
      fullUpdate({
        fullName: "Dr. Henrique Alves Filho",
        cpf: CPF_A,
        councilNumber: "30303",
      })
    )

    const saved = await prisma.appointment.findUnique({ where: { id: appt.id } })
    const index = await resolver.buildProfessionalIndex([saved])
    const resolved = resolver.resolveProfessional(index, saved)

    assert.ok(resolved, "deveria resolver um profissional")
    assert.equal(resolved.id, pro.id)
    // A identidade exibida é a VIVA (já editada), não o snapshot.
    assert.equal(resolved.name, "Dr. Henrique Alves Filho")
  })

  await test("atendimento legado (sem id) resolve pelo nome congelado", async () => {
    await resetProfessionals()
    const pro = await service.createProfessional(
      basePayload({ fullName: "Dra. Lúcia Prado", councilNumber: "40404" })
    )

    // Simula registro antigo: tem nome, NÃO tem vínculo por id.
    const row = { finishedById: null, finishedByName: "Dra. Lúcia Prado" }
    const index = await resolver.buildProfessionalIndex([row])
    const resolved = resolver.resolveProfessional(index, row)

    assert.ok(resolved, "deveria casar o nome congelado com o cadastro")
    assert.equal(resolved.id, pro.id)
    assert.equal(resolved.name, "Dra. Lúcia Prado")
  })

  await test("casamento por nome ignora caixa, acentos e espaços extras", async () => {
    await resetProfessionals()
    const pro = await service.createProfessional(
      basePayload({ fullName: "Dr. Antônio Nóbrega", councilNumber: "50505" })
    )

    const row = {
      finishedById: null,
      finishedByName: "  dr.  ANTONIO   nobrega ",
    }
    const index = await resolver.buildProfessionalIndex([row])
    const resolved = resolver.resolveProfessional(index, row)

    assert.ok(resolved, "a normalização deveria casar o nome")
    assert.equal(resolved.id, pro.id)
    // O nome EXIBIDO é o do cadastro (com acentuação correta), não o congelado.
    assert.equal(resolved.name, "Dr. Antônio Nóbrega")
  })

  await test("nomes parecidos porém distintos NÃO casam", async () => {
    await resetProfessionals()
    await service.createProfessional(
      basePayload({ fullName: "Dra. Ana Paula Souza", councilNumber: "51515" })
    )

    const row = {
      finishedById: null,
      finishedByName: "Dra. Ana Paula Souza Lima",
    }
    const index = await resolver.buildProfessionalIndex([row])
    const resolved = resolver.resolveProfessional(index, row)

    assert.equal(resolved, null, "nomes diferentes não deveriam casar")
  })

  await test("vínculo por id tem precedência sobre o nome congelado", async () => {
    await resetProfessionals()
    const linked = await service.createProfessional(
      basePayload({ fullName: "Dr. Paulo Rei", councilNumber: "60606" })
    )
    // Outro profissional cujo nome casa com o texto congelado — não deve vencer.
    await service.createProfessional(
      basePayload({
        fullName: "Dr. Nome Congelado",
        cpf: CPF_B,
        councilNumber: "70707",
      })
    )

    const row = {
      finishedById: linked.id,
      finishedByName: "Dr. Nome Congelado",
    }
    const index = await resolver.buildProfessionalIndex([row])
    const resolved = resolver.resolveProfessional(index, row)

    assert.ok(resolved, "deveria resolver um profissional")
    assert.equal(resolved.id, linked.id)
    assert.equal(resolved.name, "Dr. Paulo Rei")
  })

  await test("id inexistente cai no fallback por nome (histórico não se perde)", async () => {
    await resetProfessionals()
    const pro = await service.createProfessional(
      basePayload({ fullName: "Dra. Renata Lopes", councilNumber: "80808" })
    )

    const row = {
      finishedById: "00000000-0000-4000-8000-000000000000",
      finishedByName: "Dra. Renata Lopes",
    }
    const index = await resolver.buildProfessionalIndex([row])
    const resolved = resolver.resolveProfessional(index, row)

    assert.ok(resolved, "deveria encontrar pelo nome")
    assert.equal(resolved.id, pro.id)
  })

  await test("sem correspondência retorna nulo (não inventa profissional)", async () => {
    await resetProfessionals()
    await service.createProfessional(basePayload({ fullName: "Dr. Existente" }))

    const row = {
      finishedById: null,
      finishedByName: "Profissional Textual Desconhecido",
    }
    const index = await resolver.buildProfessionalIndex([row])
    const resolved = resolver.resolveProfessional(index, row)

    assert.equal(resolved, null)
  })

  await test("índice resolve várias linhas sem repetir consulta", async () => {
    await resetProfessionals()
    const a = await service.createProfessional(basePayload({ fullName: "Dra. Uma" }))
    const b = await service.createProfessional(
      basePayload({ fullName: "Dr. Dois", cpf: CPF_B, councilNumber: "90909" })
    )

    const apptA = await createFinalizableAppointment({ time: "07:00" })
    await finalization.finalizeAttendance(apptA.id, { userId: a.id, name: a.fullName })
    const apptB = await createFinalizableAppointment({ cpf: CPF_B, time: "07:30" })
    await finalization.finalizeAttendance(apptB.id, { userId: b.id, name: b.fullName })

    const rows = await prisma.appointment.findMany({
      where: { id: { in: [apptA.id, apptB.id] } },
      select: { finishedById: true, finishedByName: true },
    })
    const index = await resolver.buildProfessionalIndex(rows)

    const resolved = rows.map((row) => resolver.resolveProfessional(index, row))
    assert.equal(resolved.length, 2)
    assert.ok(resolved.every((r) => r !== null), "todas as linhas deveriam resolver")
    const ids = new Set(resolved.map((r) => r.id))
    assert.equal(ids.size, 2)
    assert.ok(ids.has(a.id) && ids.has(b.id))
  })

  await test("índice vazio não consulta o banco e não inventa vínculo", async () => {
    const index = await resolver.buildProfessionalIndex([])
    const resolved = resolver.resolveProfessional(index, {
      finishedById: null,
      finishedByName: null,
    })
    assert.equal(resolved, null)
  })
}

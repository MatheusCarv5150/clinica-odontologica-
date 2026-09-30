// ===========================================================================
// CENÁRIOS DE DOMÍNIO — USUÁRIOS/PROFISSIONAIS (Configurações).
//
// Testes PUROS (sem banco): garantem que a validação de CPF, a normalização e
// a formatação do rótulo do conselho estão corretas antes de qualquer
// persistência. Estas são as regras que o backend usa como autoridade.
//
// Executado por scripts/test-professionals.mjs.
// ===========================================================================

import { domain, schemas, test, section, assert } from "./_professionals-harness.mjs"

export async function runDomainScenarios() {
  section("Domínio — validação de CPF")

  await test("CPF válido é aceito (com e sem máscara)", () => {
    assert.equal(domain.validateCPF("52998224725"), true)
    assert.equal(domain.validateCPF("529.982.247-25"), true)
  })

  await test("CPF com dígito verificador errado é rejeitado", () => {
    assert.equal(domain.validateCPF("52998224724"), false)
  })

  await test("CPF com tamanho inválido é rejeitado", () => {
    assert.equal(domain.validateCPF("5299822472"), false)
    assert.equal(domain.validateCPF("529982247251"), false)
    assert.equal(domain.validateCPF(""), false)
  })

  await test("sequências repetidas são rejeitadas", () => {
    assert.equal(domain.validateCPF("00000000000"), false)
    assert.equal(domain.validateCPF("11111111111"), false)
    assert.equal(domain.validateCPF("999.999.999-99"), false)
  })

  section("Domínio — normalização")

  await test("CPF é normalizado para apenas dígitos", () => {
    assert.equal(domain.normalizeCpf("529.982.247-25"), "52998224725")
    assert.equal(domain.normalizeCpf(" 529 982 247 25 "), "52998224725")
  })

  await test("nome tem espaços colapsados nas extremidades e no meio", () => {
    assert.equal(domain.normalizeName("  João   da   Silva  "), "João da Silva")
  })

  section("Domínio — formatação")

  await test("CPF é formatado com máscara", () => {
    assert.equal(domain.formatCpf("52998224725"), "529.982.247-25")
  })

  await test("CPF incompleto não é mascarado", () => {
    assert.equal(domain.formatCpf("529982"), "529982")
  })

  await test("rótulo do conselho inclui UF apenas quando informada", () => {
    assert.equal(domain.formatCouncilLabel("CRO", "12345", "PE"), "CRO-PE 12345")
    assert.equal(domain.formatCouncilLabel("CRO", "12345", null), "CRO 12345")
    assert.equal(domain.formatCouncilLabel("CRO", "12345", ""), "CRO 12345")
  })

  await test("status é rotulado em português", () => {
    assert.equal(domain.statusLabel("active"), "Ativo")
    assert.equal(domain.statusLabel("inactive"), "Inativo")
  })

  section("Contrato — schema de entrada")

  await test("payload válido passa no schema", () => {
    const parsed = schemas.professionalSchema.safeParse({
      fullName: "  João   da Silva ",
      birthDate: "1985-04-12",
      cpf: "529.982.247-25",
      councilType: "CRO",
      councilNumber: "12345",
      councilState: "pe",
      status: "active",
    })
    assert.equal(parsed.success, true)
    assert.equal(parsed.data.fullName, "João da Silva")
    assert.equal(parsed.data.cpf, "52998224725")
    assert.equal(parsed.data.councilState, "PE")
  })

  await test("payload com CPF inválido é rejeitado", () => {
    const parsed = schemas.professionalSchema.safeParse({
      fullName: "João da Silva",
      birthDate: "1985-04-12",
      cpf: "111.111.111-11",
      councilType: "CRO",
      councilNumber: "12345",
      councilState: "PE",
    })
    assert.equal(parsed.success, false)
  })

  await test("data de nascimento futura é rejeitada", () => {
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    const parsed = schemas.professionalSchema.safeParse({
      fullName: "João da Silva",
      birthDate: future.toISOString().split("T")[0],
      cpf: "529.982.247-25",
      councilType: "CRO",
      councilNumber: "12345",
    })
    assert.equal(parsed.success, false)
  })

  await test("conselho fora da lista é rejeitado", () => {
    const parsed = schemas.professionalSchema.safeParse({
      fullName: "João da Silva",
      birthDate: "1985-04-12",
      cpf: "529.982.247-25",
      councilType: "XPTO",
      councilNumber: "12345",
    })
    assert.equal(parsed.success, false)
  })

  await test("UF inválida é rejeitada", () => {
    const parsed = schemas.professionalSchema.safeParse({
      fullName: "João da Silva",
      birthDate: "1985-04-12",
      cpf: "529.982.247-25",
      councilType: "CRO",
      councilNumber: "12345",
      councilState: "PEA",
    })
    assert.equal(parsed.success, false)
  })
}

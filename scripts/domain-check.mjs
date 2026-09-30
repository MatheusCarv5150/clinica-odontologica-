// ===========================================================================
// Verificação dos módulos de DOMÍNIO e de SCHEMA da anamnese (Parte 4).
//
// Estes módulos são .ts e usam o alias "@/..." do Next. Como o projeto não tem
// (e não deve ganhar) um transpiler só para testes, este script:
//   1. compila os dois módulos para JS temporário com o TypeScript que JÁ é
//      dependência do projeto (typescript/bin/tsc), resolvendo o alias;
//   2. importa o JS gerado e valida as regras de negócio puras.
//
// As regras puras são justamente as que GARANTEM os comportamentos exigidos:
// nada de diagnóstico automático, "unknown" != "no", enum fechado de respostas,
// normalização de itens e alertas clínicos.
//
// Execução: node scripts/domain-check.mjs
// ===========================================================================

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import assert from "node:assert/strict"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")

let passed = 0
let failed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failed++
    failures.push({ name, error })
    console.log(`  ✗ ${name}`)
    console.log(`      ${error.message}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

// ---------------------------------------------------------------------------
// Compilação sob demanda dos módulos de domínio
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(path.join(root, ".domain-check-"))

function compile(sources) {
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ES2022",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      outDir: "./out",
      rootDir: "./src",
      baseUrl: "./src",
      paths: { "@/*": ["./*"] },
      verbatimModuleSyntax: false,
    },
    include: ["src/**/*.ts"],
  }

  const work = outDir
  const srcDir = path.join(work, "src", "lib")
  mkdirSync(srcDir, { recursive: true })

  writeFileSync(path.join(work, "tsconfig.json"), JSON.stringify(tsconfig, null, 2))
  for (const rel of sources) {
    writeFileSync(
      path.join(work, "src", rel),
      readFileSync(path.join(root, "src", rel), "utf8"),
    )
  }

  try {
    execFileSync(
      process.execPath,
      [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", work],
      { stdio: "pipe" },
    )
  } catch (error) {
    const stdout = error.stdout ? error.stdout.toString() : ""
    const stderr = error.stderr ? error.stderr.toString() : ""
    throw new Error(`tsc falhou:\n${stdout}\n${stderr}`)
  }

  return path.join(work, "out")
}

let domain
let schemas

try {
  const out = compile(["lib/anamnesis-domain.ts", "lib/schemas-anamnesis.ts"])
  domain = await import(pathToFileURL(path.join(out, "lib", "anamnesis-domain.js")).href)
  schemas = await import(pathToFileURL(path.join(out, "lib", "schemas-anamnesis.js")).href)
} catch (error) {
  console.error("Não foi possível compilar os módulos de domínio:", error.message)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Cenários de domínio
// ---------------------------------------------------------------------------

// buildClinicalAlerts exige TODAS as coleções (não são opcionais no tipo).
function emptySource(overrides = {}) {
  return {
    conditions: [],
    allergies: [],
    medications: [],
    answers: [],
    ...overrides,
  }
}

console.log("Verificação do DOMÍNIO da anamnese — Parte 4")

section("1. Respostas: 'não sabe' nunca vira 'não'")

await test("isAnswerValue aceita apenas yes/no/unknown", () => {
  assert.equal(domain.isAnswerValue("yes"), true)
  assert.equal(domain.isAnswerValue("no"), true)
  assert.equal(domain.isAnswerValue("unknown"), true)
  assert.equal(domain.isAnswerValue("sim"), false)
  assert.equal(domain.isAnswerValue(""), false)
  assert.equal(domain.isAnswerValue(null), false)
})

await test("rótulos distinguem 'Não' de 'Não sabe'", () => {
  assert.notEqual(domain.ANSWER_LABELS.no, domain.ANSWER_LABELS.unknown)
  assert.match(domain.ANSWER_LABELS.unknown, /Não sabe/)
  assert.equal(domain.ANSWER_LABELS.no, "Não")
  assert.equal(domain.ANSWER_LABELS.yes, "Sim")
})

await test("rótulo curto também distingue os três valores", () => {
  assert.equal(domain.ANSWER_SHORT_LABELS.yes, "Sim")
  assert.equal(domain.ANSWER_SHORT_LABELS.no, "Não")
  assert.match(domain.ANSWER_SHORT_LABELS.unknown, /Não informado/)
  assert.equal(
    new Set(Object.values(domain.ANSWER_SHORT_LABELS)).size,
    3,
    "rótulos curtos devem ser distintos entre si",
  )
})

section("2. Catálogo de perguntas")

await test("toda pergunta tem chave, seção, rótulo e ordem", () => {
  const all = [
    ...domain.MEDICAL_HISTORY_QUESTIONS,
    ...domain.HABITS_QUESTIONS,
    ...domain.DENTAL_HISTORY_QUESTIONS,
  ]
  assert.ok(all.length >= 26, `esperado >= 26 perguntas, obtido ${all.length}`)
  for (const q of all) {
    assert.equal(typeof q.key, "string")
    assert.ok(q.key.includes("."), `chave fora do padrão seção.campo: ${q.key}`)
    assert.equal(typeof q.label, "string")
    assert.ok(q.label.length > 0)
    assert.equal(typeof q.section, "string")
  }
})

await test("chaves de perguntas são únicas", () => {
  const all = [
    ...domain.MEDICAL_HISTORY_QUESTIONS,
    ...domain.HABITS_QUESTIONS,
    ...domain.DENTAL_HISTORY_QUESTIONS,
  ].map((q) => q.key)
  assert.equal(new Set(all).size, all.length)
})

await test("getQuestion resolve por chave e devolve undefined para desconhecida", () => {
  assert.equal(domain.getQuestion("medical.cardiac")?.key, "medical.cardiac")
  assert.equal(domain.getQuestion("nao.existe"), undefined)
})

await test("getQuestionLabel cai para a própria chave quando desconhecida", () => {
  assert.equal(domain.getQuestionLabel("medical.cardiac"), domain.getQuestion("medical.cardiac").label)
  assert.equal(domain.getQuestionLabel("nao.existe"), "nao.existe")
})

section("3. Alertas clínicos — sem diagnóstico automático")

await test("nenhum alerta quando não há dados", () => {
  assert.deepEqual(domain.buildClinicalAlerts(emptySource()), [])
})

await test("resposta 'no' não gera alerta", () => {
  const alerts = domain.buildClinicalAlerts(
    emptySource({
      answers: [{ questionKey: "medical.cardiac", value: "no", note: null }],
    }),
  )
  assert.deepEqual(alerts, [])
})

await test("resposta 'unknown' não gera alerta (não sabe != positivo)", () => {
  const alerts = domain.buildClinicalAlerts(
    emptySource({
      answers: [{ questionKey: "medical.cardiac", value: "unknown", note: null }],
    }),
  )
  assert.deepEqual(alerts, [])
})

await test("pergunta 'sim' fora da lista crítica não gera alerta", () => {
  const alerts = domain.buildClinicalAlerts(
    emptySource({
      answers: [{ questionKey: "habits.alcohol", value: "yes", note: null }],
    }),
  )
  assert.deepEqual(alerts, [])
})

await test("resposta positiva crítica gera alerta informativo", () => {
  const alerts = domain.buildClinicalAlerts(
    emptySource({
      answers: [{ questionKey: "medical.cardiac", value: "yes", note: "marcapasso" }],
    }),
  )
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].kind, "answer")
  assert.equal(alerts[0].detail, "marcapasso")
})

await test("alergia registrada gera alerta com a reação no detalhe", () => {
  const alerts = domain.buildClinicalAlerts(
    emptySource({
      allergies: [{ label: "Penicilina", reaction: "urticária", note: null }],
    }),
  )
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].kind, "allergy")
  assert.match(alerts[0].text, /Penicilina/)
  assert.equal(alerts[0].detail, "urticária")
})

await test("medicamento inativo não gera alerta; ativo gera", () => {
  const inactive = domain.buildClinicalAlerts(
    emptySource({
      medications: [{ label: "Losartana", active: false, dosage: null, frequency: null }],
    }),
  )
  assert.deepEqual(inactive, [])

  const active = domain.buildClinicalAlerts(
    emptySource({
      medications: [{ label: "Varfarina", active: true, dosage: "5mg", frequency: "1x/dia" }],
    }),
  )
  assert.equal(active.length, 1)
  assert.match(active[0].text, /Varfarina 5mg/)
})

await test("mesmo alerta de resposta não é duplicado quando já existe condição igual", () => {
  const alerts = domain.buildClinicalAlerts(
    emptySource({
      conditions: [{ label: domain.getQuestionLabel("medical.diabetes"), note: null }],
      answers: [{ questionKey: "medical.diabetes", value: "yes", note: null }],
    }),
  )
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].kind, "condition")
})

await test("alertas não afirmam diagnóstico, apenas reportam o registro", () => {
  const alerts = domain.buildClinicalAlerts(
    emptySource({
      conditions: [{ label: "Diabetes", note: null }],
      allergies: [{ label: "Dipirona", reaction: null, note: null }],
    }),
  )
  const joined = alerts
    .map((a) => `${a.text} ${a.detail ?? ""}`)
    .join(" ")
    .toLowerCase()
  for (const forbidden of [
    "diagnostic",
    "suspeita de",
    "provavelmente",
    "indica que o paciente tem",
    "recomenda-se",
  ]) {
    assert.ok(!joined.includes(forbidden), `alerta contém juízo clínico: "${forbidden}"`)
  }
})

section("4. Condições e opções de itens")

await test("CONDITION_OPTIONS inclui a opção 'outras'", () => {
  assert.equal(domain.getConditionLabel(domain.CONDITION_OTHER_KEY), "Outras")
})

await test("getConditionLabel resolve e devolve null para chave desconhecida", () => {
  const first = domain.CONDITION_OPTIONS[0]
  assert.equal(domain.getConditionLabel(first.key), first.label)
  assert.equal(domain.getConditionLabel("inexistente"), null)
})

await test("opções de condição têm chaves únicas", () => {
  const keys = domain.CONDITION_OPTIONS.map((o) => o.key)
  assert.equal(new Set(keys).size, keys.length)
})

await test("tipos de item têm rótulo legível", () => {
  for (const type of ["condition", "allergy", "medication", "surgery"]) {
    assert.ok(domain.ITEM_TYPE_LABELS[type], `sem rótulo para ${type}`)
  }
})

await test("níveis de intensidade e ansiedade são faixas fechadas", () => {
  assert.ok(domain.COMPLAINT_INTENSITY_OPTIONS.length >= 3)
  assert.ok(domain.ANXIETY_LEVEL_OPTIONS.length >= 3)
})

section("5. Formatação")

await test("data e data-hora são formatadas sem timezone ambíguo", () => {
  const iso = "2026-09-10T13:45:00.000Z"
  assert.ok(domain.formatAnamnesisDate(iso).includes("2026"))
  assert.ok(domain.formatAnamnesisDateTime(iso).includes("2026"))
})

await test("responsável vazio vira texto neutro", () => {
  assert.equal(domain.formatResponsible(null), "Não identificado")
  assert.equal(domain.formatResponsible(""), "Não identificado")
  assert.equal(domain.formatResponsible("   "), "Não identificado")
  assert.equal(domain.formatResponsible("Dra. Ana"), "Dra. Ana")
})

await test("data inválida não quebra a formatação", () => {
  assert.equal(typeof domain.formatAnamnesisDate(null), "string")
  assert.equal(typeof domain.formatAnamnesisDateTime(undefined), "string")
})

section("6. Validação Zod (schema real)")

await test("schema rejeita valor fora do enum yes/no/unknown", () => {
  const r = schemas.anamnesisAnswerInputSchema.safeParse({
    questionKey: "medical.cardiac",
    section: "medical",
    value: "talvez",
  })
  assert.equal(r.success, false)
})

await test("schema aceita resposta válida com observação", () => {
  const r = schemas.anamnesisAnswerInputSchema.safeParse({
    questionKey: "medical.cardiac",
    section: "medical_history",
    value: "yes",
    note: "arritmia controlada",
  })
  assert.equal(r.success, true, JSON.stringify(r.error?.issues))
  assert.equal(r.data.note, "arritmia controlada")
})

await test("schema rejeita seção desconhecida", () => {
  const r = schemas.anamnesisAnswerInputSchema.safeParse({
    questionKey: "x.y",
    section: "secao_inventada",
    value: "yes",
  })
  assert.equal(r.success, false)
})

await test("perfil clínico completo é aceito", () => {
  const r = schemas.clinicalProfileSchema.safeParse({
    answers: [{ questionKey: "medical.cardiac", section: "medical_history", value: "no" }],
    conditions: [{ type: "condition", label: "Hipertensão" }],
    allergies: [{ type: "allergy", label: "Penicilina", reaction: "rash" }],
    medications: [{ type: "medication", label: "Losartana", dosage: "50mg", active: true }],
    surgeries: [{ type: "surgery", label: "Apendicectomia", year: "2015" }],
    notes: "Paciente relata boa saúde geral.",
  })
  assert.equal(r.success, true, JSON.stringify(r.error?.issues))
})

await test("payload de salvamento aceita sessão sem responsável (sem autenticação)", () => {
  const ok = schemas.saveAnamnesisSchema.safeParse({
    session: {},
    responsibleName: "Dra. Ana",
  })
  assert.equal(ok.success, true, JSON.stringify(ok.error?.issues))

  // Sem autenticação o servidor não inventa usuário: o campo é opcional.
  const semResponsavel = schemas.saveAnamnesisSchema.safeParse({ session: {} })
  assert.equal(semResponsavel.success, true)
  assert.ok(!semResponsavel.data.responsibleName)
})

await test("payload de salvamento rejeita sessão ausente", () => {
  const r = schemas.saveAnamnesisSchema.safeParse({ responsibleName: "Dra. Ana" })
  assert.equal(r.success, false)
})

await test("payload de salvamento rejeita nível de ansiedade inválido", () => {
  const r = schemas.saveAnamnesisSchema.safeParse({
    session: { anxietyLevel: "extremo" },
  })
  assert.equal(r.success, false)
})

await test("schema rejeita item sem rótulo", () => {
  const r = schemas.anamnesisItemInputSchema.safeParse({
    type: "allergy",
    label: "   ",
  })
  assert.equal(r.success, false)
})

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

console.log(`\n${"─".repeat(50)}`)
console.log(`Resultado: ${passed} passaram, ${failed} falharam`)

if (failures.length > 0) {
  console.log("\nFalhas:")
  for (const f of failures) {
    console.log(`  • ${f.name}: ${f.error.message}`)
  }
}

rmSync(outDir, { recursive: true, force: true })
process.exit(failed > 0 ? 1 : 0)

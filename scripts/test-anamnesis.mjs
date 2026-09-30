// ===========================================================================
// Runner dos testes de INTEGRAÇÃO da ANAMNESE (Parte 4).
//
// Executa os cenários contra o SERVIÇO REAL (src/lib/anamnesis-service.ts) e o
// banco Prisma configurado em .env — sem mocks, sem banco em memória.
//
// Execução: node scripts/test-anamnesis.mjs
// (ou: npm run test:anamnesis)
// ===========================================================================

import { rmSync } from "node:fs"
import {
  prisma,
  section,
  outDir,
  purgeTestData,
  summary,
} from "./_anamnesis-harness.mjs"

import { runScenarios } from "./_anamnesis-scenarios-part1.mjs"

try {
  console.log("Testes de INTEGRAÇÃO da ANAMNESE — Parte 4\n")

  // Idempotência: remove resíduos de execuções anteriores antes de começar.
  await purgeTestData()
  const fixtures = await runScenarios()

  // Os cenários restantes são executados nas partes seguintes.
  const { runClinicalScenarios } = await import("./_anamnesis-scenarios-part2.mjs")
  await runClinicalScenarios(fixtures)

  const { runIsolationScenarios } = await import("./_anamnesis-scenarios-part3.mjs")
  await runIsolationScenarios(fixtures)

  const { runIntegrityScenarios } = await import("./_anamnesis-scenarios-part4.mjs")
  await runIntegrityScenarios(fixtures)
} catch (error) {
  console.error("\nErro fatal durante os testes:", error)
  summary.recordFatal(error)
} finally {
  try {
    await purgeTestData()
  } catch (error) {
    console.error("Aviso: falha ao limpar dados de teste:", error.message)
  }
  await prisma.$disconnect()
  rmSync(outDir, { recursive: true, force: true })

  const exitCode = summary.report()
  process.exit(exitCode)
}

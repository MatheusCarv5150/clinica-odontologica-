// ===========================================================================
// Runner dos testes da PARTE 10.
//
// (Plano de Tratamento 10.1 · Prescrição 10.2 · Documentos/Imagens 10.3)
//
// Executa:
//   1. regras de domínio (puras, sem banco);
//   2. cenários de integração contra os SERVIÇOS REAIS e um SQLite descartável.
//
// Execução: node scripts/test-part10.mjs
// ===========================================================================

import { cleanup, summary } from "./_part10-harness.mjs"

try {
  console.log("Testes da PARTE 10 — Plano · Prescrição · Documentos\n")

  const { runDomainScenarios } = await import("./_part10-domain-scenarios.mjs")
  await runDomainScenarios()

  const { runTreatmentPlanScenarios, runPrescriptionScenarios, runDocumentScenarios } =
    await import("./_part10-scenarios.mjs")

  await runTreatmentPlanScenarios()
  await runPrescriptionScenarios()
  await runDocumentScenarios()
} catch (error) {
  console.error("\nErro fatal durante os testes:", error)
  summary.recordFatal(error)
} finally {
  await cleanup()
}

process.exit(summary.report())

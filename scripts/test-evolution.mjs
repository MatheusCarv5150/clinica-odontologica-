// ===========================================================================
// Runner dos testes da EVOLUÇÃO CRONOLÓGICA (Parte 8).
//
// Executa:
//   1. regras de domínio (puras, sem banco);
//   2. cenários de integração contra os SERVIÇOS REAIS e um SQLite descartável.
//
// Execução: node scripts/test-evolution.mjs
// ===========================================================================

import { cleanup, summary } from "./_evolution-harness.mjs"

try {
  console.log("Testes da EVOLUÇÃO CRONOLÓGICA — Parte 8\n")

  const { runDomainScenarios } = await import("./_evolution-domain-scenarios.mjs")
  await runDomainScenarios()

  const { runIntegrationScenarios } = await import("./_evolution-scenarios.mjs")
  await runIntegrationScenarios()
} catch (error) {
  console.error("\nErro fatal durante os testes:", error)
  summary.recordFatal(error)
} finally {
  await cleanup()
}

process.exit(summary.report())

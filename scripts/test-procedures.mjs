// ===========================================================================
// Runner dos testes de PROCEDIMENTOS (Parte 7).
//
// Executa:
//   1. regras de domínio (puras, sem banco);
//   2. cenários de integração contra o SERVIÇO REAL e um SQLite descartável.
//
// Execução: node scripts/test-procedures.mjs
// ===========================================================================

import { cleanup, summary } from "./_procedures-harness.mjs"

try {
  console.log("Testes de PROCEDIMENTOS — Parte 7\n")

  const { runDomainScenarios } = await import(
    "./_procedures-domain-scenarios.mjs"
  )
  await runDomainScenarios()

  const { runIntegrationScenarios } = await import(
    "./_procedures-scenarios.mjs"
  )
  await runIntegrationScenarios()
} catch (error) {
  console.error("\nErro fatal durante os testes:", error)
  summary.recordFatal(error)
} finally {
  await cleanup()
}

process.exit(summary.report())

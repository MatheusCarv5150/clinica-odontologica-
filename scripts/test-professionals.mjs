// ===========================================================================
// Runner dos testes de USUÁRIOS/PROFISSIONAIS (Configurações).
//
// Executa:
//   1. regras de domínio (puras, sem banco);
//   2. cenários de integração contra o SERVIÇO REAL e um SQLite descartável.
//
// Execução: node scripts/test-professionals.mjs
// ===========================================================================

import { cleanup, summary } from "./_professionals-harness.mjs"

try {
  console.log("Testes de USUÁRIOS/PROFISSIONAIS — Configurações\n")

  const { runDomainScenarios } = await import("./_professionals-domain-scenarios.mjs")
  await runDomainScenarios()

  const { runIntegrationScenarios } = await import("./_professionals-scenarios.mjs")
  await runIntegrationScenarios()
} catch (error) {
  console.error("\nErro fatal durante os testes:", error)
  summary.recordFatal(error)
} finally {
  await cleanup()
}

process.exit(summary.report())

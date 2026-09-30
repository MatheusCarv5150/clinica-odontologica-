// ===========================================================================
// RUNNER DOS TESTES FINANCEIROS (Financeiro 1 e Financeiro 2).
// ===========================================================================

import { runDomainScenarios } from "./_financial-domain-scenarios.mjs"
import { runIntegrationScenarios } from "./_financial-scenarios.mjs"
import { runIntegrationScenariosPart2 } from "./_financial-scenarios-2.mjs"
import { runReceitasScenarios } from "./_financial-receitas-scenarios.mjs"
import { runContasReceberScenarios } from "./_financial-contas-receber-scenarios.mjs"
import { summary, cleanup } from "./_financial-harness.mjs"

console.log("Testes do FINANCEIRO — Parte 11 (Financeiro 1) e Parte 12 (Financeiro 2)")

try {
  await runDomainScenarios()
  await runIntegrationScenarios()
  await runIntegrationScenariosPart2()
  await runReceitasScenarios()
  await runContasReceberScenarios()
} catch (error) {
  summary.recordFatal(error)
} finally {
  const code = summary.report()
  await cleanup()
  process.exit(code)
}

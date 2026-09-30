// ===========================================================================
// RUNNER — CENÁRIOS DE DESPESAS (Financeiro 4, implementação consolidada).
// ===========================================================================
// Executa `_financial-despesas-scenarios.mjs` com o harness compartilhado.

import { summary } from "./_financial-harness.mjs"
import { runDespesasScenarios } from "./_financial-despesas-scenarios.mjs"

try {
  await runDespesasScenarios()
} catch (error) {
  summary.recordFatal(error)
}

process.exit(summary.report())

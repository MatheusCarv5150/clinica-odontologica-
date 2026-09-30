// ===========================================================================
// RUNNER — CENÁRIOS DO FLUXO DE CAIXA (Financeiro 5).
// ===========================================================================
// Executa `_financial-cash-flow-scenarios.mjs` com o harness compartilhado.

import { summary, cleanup } from "./_financial-harness.mjs"
import { runCashFlowScenarios } from "./_financial-cash-flow-scenarios.mjs"

try {
  await runCashFlowScenarios()
} catch (error) {
  summary.recordFatal(error)
}

await cleanup()
process.exit(summary.report())

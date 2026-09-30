// ===========================================================================
// RUNNER — CENÁRIOS DE RELATÓRIOS E FECHAMENTO (Financeiro 6).
// ===========================================================================
// Executa `_financial-reports-scenarios.mjs` e `_financial-closing-scenarios.mjs`
// com o harness compartilhado. Cobre a consolidação dos relatórios (sem segunda
// fonte de verdade) e o ciclo de fechamento/reabertura/auditoria.

import { summary, cleanup } from "./_financial-harness.mjs"
import { runReportsScenarios } from "./_financial-reports-scenarios.mjs"
import { runClosingScenarios } from "./_financial-closing-scenarios.mjs"

try {
  await runReportsScenarios()
} catch (error) {
  summary.recordFatal(error)
}

try {
  await runClosingScenarios()
} catch (error) {
  summary.recordFatal(error)
}

await cleanup()
process.exit(summary.report())

// ===========================================================================
// RUNNER DOS TESTES DE FINALIZAÇÃO DO ATENDIMENTO (Parte 9).
// ===========================================================================

import {
  runIntegrationScenarios,
} from "./_finalization-scenarios.mjs"
import { summary, cleanup } from "./_finalization-harness.mjs"

try {
  await runIntegrationScenarios()
} catch (error) {
  summary.recordFatal(error)
} finally {
  const code = summary.report()
  await cleanup()
  process.exit(code)
}

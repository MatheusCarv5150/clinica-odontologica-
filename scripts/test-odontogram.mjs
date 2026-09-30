// ===========================================================================
// Runner dos testes do ODONTOGRAMA (Parte 5).
//
// Executa:
//   1. regras de domínio (puras, sem banco);
//   2. cenários de integração contra o SERVIÇO REAL e o banco de .env.
//
// Execução: node scripts/test-odontogram.mjs
// ===========================================================================

import { rmSync } from "node:fs"
import { outDir, purgeTestData, summary } from "./_odontogram-harness.mjs"

try {
  console.log("Testes do ODONTOGRAMA — Parte 5\n")

  // Idempotência: remove resíduos de execuções anteriores.
  await purgeTestData()

  const { runDomainScenarios } = await import(
    "./_odontogram-domain-scenarios.mjs"
  )
  await runDomainScenarios()

  const { runIntegrationScenarios } = await import(
    "./_odontogram-scenarios.mjs"
  )
  await runIntegrationScenarios()
} catch (error) {
  console.error("\nErro fatal durante os testes:", error)
  summary.recordFatal(error)
} finally {
  await purgeTestData()
  rmSync(outDir, { recursive: true, force: true })
}

process.exit(summary.report())

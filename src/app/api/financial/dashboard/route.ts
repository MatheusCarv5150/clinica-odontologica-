import { NextRequest, NextResponse } from "next/server"
import { getFinancialDashboard } from "@/lib/financial-dashboard-service"
import { syncIncomeFromPayments } from "@/lib/financial-service"
import { parsePeriodFromSearchParams } from "@/lib/schemas-financial"

export const dynamic = "force-dynamic"

// GET /api/financial/dashboard?period=month&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Dashboard Financeiro (Financeiro 1).
//
// PROJEÇÃO DE DADOS REAIS — nenhum valor é inventado. Sem movimentações no
// período, os totais retornam 0 e as listas ficam vazias (o gráfico não recebe
// registros fictícios).
//
// DISTINÇÕES preservadas na resposta:
//   cash.received      -> recebido de fato (pagamento efetivado)
//   cash.expectedIn    -> previsto, ainda não recebido
//   income.expected    -> receita prevista no período (não é recebido)
//   accountsReceivable -> PREVISÃO de recebimento (não é receita)
//
// SEGURANÇA (single-tenant + isolamento por relacionamento):
//   - não há clinicId/tenantId nesta fase (decisão 2-A);
//   - o paciente de cada movimentação é resolvido no SERVIDOR a partir do
//     vínculo (nunca de parâmetro do cliente);
//   - não existe checagem de permissão porque ainda não existe autenticação
//     real (decisão 3-A). Este endpoint NÃO finge autorizar: ele apenas valida
//     entrada e integridade.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const period = parsePeriodFromSearchParams(searchParams)

    // `sync` opcional: garante que pagamentos registrados na Agenda já estejam
    // refletidos no fluxo. É idempotente e não altera pagamentos.
    const shouldSync = searchParams.get("sync") !== "0"
    if (shouldSync) {
      await syncIncomeFromPayments()
    }

    const dashboard = await getFinancialDashboard({
      preset: period.preset,
      from: period.from,
      to: period.to,
    })

    return NextResponse.json(dashboard)
  } catch (error) {
    console.error("Erro ao montar o dashboard financeiro:", error)
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    )
  }
}

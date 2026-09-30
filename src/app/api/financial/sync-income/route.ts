import { NextResponse } from "next/server"
import { syncIncomeFromPayments } from "@/lib/financial-service"

export const dynamic = "force-dynamic"

// POST /api/financial/sync-income
//
// Reconstrói a visão consolidada de receitas a partir dos pagamentos EXISTENTES.
//
// O que faz:
//   - garante UMA movimentação de receita por pagamento (`payment_id` único);
//   - atualiza status quando o pagamento muda (paid / pending / refunded);
//   - resolve o paciente a partir do atendimento do pagamento.
//
// O que NÃO faz:
//   - não cria, altera nem apaga pagamentos (a fonte é intocada);
//   - não cria dados fictícios;
//   - não lê identidade do cliente como autenticação.
//
// Idempotente: pode ser chamado quantas vezes for necessário.
export async function POST() {
  try {
    const result = await syncIncomeFromPayments()
    return NextResponse.json(result)
  } catch (error) {
    console.error("Erro ao sincronizar receitas:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

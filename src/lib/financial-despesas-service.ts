// ===========================================================================
// SERVIÇO DE DESPESAS — CAMADA DE COMPATIBILIDADE (Financeiro 4).
// ===========================================================================
//
// A implementação paralela de Despesas (ex-"financial-despesas-service") foi
// CONSOLIDADA no service canônico `@/lib/financial-expense-service`.
//
// Este arquivo existe apenas para não quebrar imports legados e NÃO contém
// nenhuma regra de negócio própria — é um re-export puro.
//
// NÃO ADICIONE lógica aqui: use `@/lib/financial-expense-service`.

export {
  // Tipos de domínio
  DESPESA_STATUSES,
  DESPESA_STATUS_LABELS,
  DESPESA_STATUS_COLORS,
  DESPESA_PAYMENT_METHODS,
  despesaStatusLabel,
  deriveDespesaStatus,
  parseDateOnly,
  // Categorias
  DEFAULT_EXPENSE_CATEGORIES,
  ensureDefaultExpenseCategories,
  listExpenseCategories,
  createExpenseCategory,
  setExpenseCategoryActive,
  // Despesas
  createDespesa,
  updateDespesa,
  registerDespesaPayment,
  cancelDespesa,
  listDespesas,
  getDespesaDetail,
  // Convênios
  listInsurancePlans,
  createInsurancePlan,
  // Tipos públicos
  type DespesaStatus,
  type DespesaItem,
  type DespesaPaymentEntry,
  type DespesaLogEntry,
  type DespesaDetail,
  type DespesasSummary,
  type ListDespesasOptions,
  type ListDespesasResult,
  type CreateDespesaInput,
  type UpdateDespesaInput,
  type RegisterDespesaPaymentInput,
  type RegisterDespesaPaymentResult,
} from "@/lib/financial-expense-service"

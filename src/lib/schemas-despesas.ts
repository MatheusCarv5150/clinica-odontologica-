// ===========================================================================
// SCHEMAS DE DESPESAS — CAMADA DE COMPATIBILIDADE (Financeiro 4).
// ===========================================================================
//
// A implementação paralela de Despesas foi CONSOLIDADA. A validação canônica
// de despesas vive em `@/lib/schemas-financial`. Este arquivo existe apenas
// para não quebrar imports legados e NÃO contém nenhuma regra própria.
//
// NÃO ADICIONE schemas novos aqui: use `@/lib/schemas-financial`.

export {
  expenseCategorySchema,
  createDespesaSchema,
  updateDespesaSchema,
  registerDespesaPaymentSchema,
  cancelDespesaSchema,
  listDespesasSchema,
  type CreateDespesaPayload,
  type UpdateDespesaPayload,
  type RegisterDespesaPaymentPayload,
  type ListDespesasInput,
} from "@/lib/schemas-financial"

-- ===========================================================================
-- FINANCEIRO 6 — RELATÓRIOS E FECHAMENTO (Parte 12)
-- ===========================================================================
--
-- ESCOPO DESTA MIGRATION
--
-- O Financeiro 6 CONSOLIDA e FECHA o módulo financeiro. Ele NÃO introduz
-- nenhuma nova fonte de verdade financeira:
--
--   * Receita recebida   -> payments              (já existe)
--   * Despesa paga       -> expense_payments      (já existe)
--   * Despesa/compromisso-> expenses              (já existe)
--   * Previsto/cobrado   -> appointments.total_amount
--                           + appointment_procedures.total_price (já existe)
--   * Catálogo           -> procedures            (já existe)
--   * Projeção de caixa  -> financial_transactions (já existe)
--
-- A ÚNICA estrutura nova é o FECHAMENTO FINANCEIRO — um conceito que ainda
-- não existia. Ele NÃO recalcula nem copia movimentações: ele apenas
-- CONFIRMA que um período foi revisado e encerrado, guardando um SNAPSHOT dos
-- totais do período no momento do fechamento (para auditoria e comparação
-- posterior com eventuais alterações retroativas).
--
-- Tabelas criadas:
--
--   * financial_closings      -> um fechamento por período [start, end]
--   * financial_closing_logs  -> auditoria de fechamento/reabertura
--
-- REGRAS QUE ESTAS TABELAS MATERIALIZAM
--
--   1. Um período fechado não pode ter dois fechamentos ativos simultâneos.
--      A UNIQUE (period_start, period_end) garante 1 fechamento por período;
--      a reabertura MARCA o registro (status = "reopened"), preservando o
--      histórico — nada é apagado.
--   2. O snapshot (`snapshot_*`) congela os números do momento do fechamento,
--      permitindo detectar alterações retroativas depois do fechamento.
--   3. Toda reabertura exige motivo e é registrada em financial_closing_logs.
--
-- IDENTIDADE TEXTUAL
--
-- `closed_by_name` / `reopened_by_name` / `performed_by_name` são ATRIBUIÇÃO
-- (quem fez), no mesmo padrão do restante do sistema. As colunas `*_by_id`
-- ficam preparadas para uma futura autenticação real (que NÃO existe nesta
-- fase). Nenhuma linha é apagada em nenhum fluxo.
--
-- PRESERVAÇÃO DE DADOS
--
-- Nenhuma tabela existente é alterada. Nenhum dado real é removido. Esta
-- migration é estritamente ADITIVA (CREATE TABLE + CREATE INDEX).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- FECHAMENTOS FINANCEIROS
-- ---------------------------------------------------------------------------
CREATE TABLE "financial_closings" (
    "id" TEXT NOT NULL PRIMARY KEY,

    -- Período fechado (início/fim EXCLUSIVO do último instante do dia).
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,

    -- "closed" | "reopened"
    "status" TEXT NOT NULL DEFAULT 'closed',

    -- SNAPSHOT dos totais no MOMENTO do fechamento (nada é recalculado aqui).
    "snapshot_income" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_expense" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_period_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_opening_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_closing_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_receivable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_payable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_result" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_income_count" INTEGER NOT NULL DEFAULT 0,
    "snapshot_expense_count" INTEGER NOT NULL DEFAULT 0,

    "notes" TEXT,

    -- ATRIBUIÇÃO (não autenticação).
    "closed_by_id" TEXT,
    "closed_by_name" TEXT,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Reabertura (preserva o registro original; nunca sobrescreve).
    "reopened_at" TIMESTAMP(3),
    "reopened_by_id" TEXT,
    "reopened_by_name" TEXT,
    "reopen_reason" TEXT,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Um único fechamento por período (reaberto permanece no histórico).
CREATE UNIQUE INDEX "financial_closings_period_start_period_end_key"
    ON "financial_closings"("period_start", "period_end");

CREATE INDEX "financial_closings_status_period_start_idx"
    ON "financial_closings"("status", "period_start");

-- ---------------------------------------------------------------------------
-- LOG DE AUDITORIA DO FECHAMENTO
-- ---------------------------------------------------------------------------
CREATE TABLE "financial_closing_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "closing_id" TEXT NOT NULL,

    -- "closed" | "reopened"
    "event" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    -- Motivo (obrigatório na reabertura) e snapshot textual anterior/novo.
    "reason" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,

    "performed_by_id" TEXT,
    "performed_by_name" TEXT,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_closing_logs_closing_id_fkey"
        FOREIGN KEY ("closing_id") REFERENCES "financial_closings"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "financial_closing_logs_closing_id_created_at_idx"
    ON "financial_closing_logs"("closing_id", "created_at");

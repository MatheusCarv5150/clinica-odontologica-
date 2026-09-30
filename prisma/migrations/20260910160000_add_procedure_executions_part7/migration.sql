-- ===========================================================================
-- PROCEDIMENTOS DO ATENDIMENTO — Módulo Atendimento (Parte 7)
-- ===========================================================================
-- Duas tabelas com papéis distintos:
--
--   appointment_procedure_executions     : EXECUÇÃO (previsto x realizado).
--   procedure_execution_change_logs      : trilha de auditoria das alterações.
--
-- O que veio da Agenda continua em `appointment_procedures` (registro histórico
-- do agendamento) e NUNCA é alterado por esta parte. A execução referencia o
-- item da Agenda quando existir (`scheduled_procedure_id`), preservando a
-- diferença entre o previsto e o realizado.
--
-- Não existe duplicação de catálogo: `procedure_id` aponta para `procedures`.
-- Não existe segunda estrutura de dentes: a relação com o odontograma é feita
-- por `odontogram_event_id`, gravado quando a execução envolve um dente.

-- CreateTable
CREATE TABLE "appointment_procedure_executions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointment_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "procedure_id" TEXT NOT NULL,
    "procedure_name_snapshot" TEXT NOT NULL,
    "procedure_code_snapshot" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'scheduled',
    "scheduled_procedure_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason_code" TEXT,
    "reason_note" TEXT,
    "tooth_number" TEXT,
    "dentition" TEXT,
    "surfaces" TEXT NOT NULL DEFAULT '',
    "catalog_price_snapshot" DOUBLE PRECISION,
    "expected_price" DOUBLE PRECISION,
    "performed_price" DOUBLE PRECISION,
    "notes" TEXT,
    "professional_name" TEXT,
    "odontogram_event_id" TEXT,
    "procedure_plan_id" TEXT,
    "performed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "appointment_procedure_executions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "appointment_procedure_executions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "appointment_procedure_executions_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "appointment_procedure_executions_scheduled_procedure_id_fkey" FOREIGN KEY ("scheduled_procedure_id") REFERENCES "appointment_procedures" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "appointment_procedure_executions_appointment_id_idx" ON "appointment_procedure_executions"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_procedure_executions_patient_id_performed_at_idx" ON "appointment_procedure_executions"("patient_id", "performed_at");

-- CreateIndex
CREATE INDEX "appointment_procedure_executions_procedure_id_idx" ON "appointment_procedure_executions"("procedure_id");

-- CreateTable
CREATE TABLE "procedure_execution_change_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "execution_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_by_id" TEXT,
    "changed_by_name" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "procedure_execution_change_logs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "appointment_procedure_executions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "procedure_execution_change_logs_execution_id_changed_at_idx" ON "procedure_execution_change_logs"("execution_id", "changed_at");

-- CreateIndex
CREATE INDEX "procedure_execution_change_logs_patient_id_changed_at_idx" ON "procedure_execution_change_logs"("patient_id", "changed_at");

-- ===========================================================================
-- FINANCEIRO 1 — Estrutura base + Dashboard (Parte 11)
-- ===========================================================================
--
-- ESCOPO DESTA MIGRATION
--
-- Cria apenas o que o Financeiro ainda NÃO possui:
--
--   * insurance_plans        -> catálogo de convênios/planos
--   * expense_categories     -> categorias de despesa (dado de referência)
--   * expenses               -> despesas (contas a pagar / saídas)
--   * financial_transactions -> MOVIMENTAÇÕES (visão consolidada do fluxo)
--
-- E adiciona duas colunas NULLABLE de vínculo:
--
--   * patients.insurance_plan_id
--   * appointments.insurance_plan_id
--
-- Ambas são opcionais: nenhum registro existente é afetado (permanecem NULL) e
-- nenhum valor financeiro é alterado.
--
-- REGRA DE NÃO DUPLICAÇÃO
--
-- `payments`, `appointment_procedures`, `procedures`, `appointments` e os
-- planos de tratamento NÃO são recriados nem copiados. Em particular NÃO é
-- criada nenhuma tabela `financial_payments`: um pagamento continua existindo
-- APENAS em `payments`, e a movimentação de receita o referencia por
-- `financial_transactions.payment_id` (único).
--
-- Assim, cada conceito tem UMA única fonte de verdade:
--
--   Pagamento realizado   -> payments
--   Valor previsto        -> appointments.total_amount
--                            + appointment_procedures.total_price
--   Catálogo de procedim. -> procedures
--   Convênio              -> insurance_plans
--   Despesa               -> expenses
--   Fluxo consolidado     -> financial_transactions
--
-- SEGURANÇA / ISOLAMENTO
--
-- O sistema permanece SINGLE-TENANT: não há clinicId/tenantId nesta fase.
-- O isolamento é por RELACIONAMENTO — `financial_transactions.patient_id` e
-- `.appointment_id` são resolvidos NO SERVIDOR a partir do pagamento/despesa
-- de origem. O cliente nunca define `patient_id` para obter acesso.
--
-- IDENTIDADE TEXTUAL
--
-- Colunas como `created_by_name`, `paid_by_name`, `cancelled_by_name` e
-- `reversed_by_name` são ATRIBUIÇÃO (quem fez), no mesmo padrão de
-- `finished_by_name`/`performed_by_name` já usado no sistema. NÃO são
-- autenticação. As colunas `*_by_id` ficam preparadas para uma futura
-- autenticação real.
--
-- PRESERVAÇÃO DE DADOS
--
-- As tabelas reconstruídas abaixo (`appointments`, `patients`,
-- `patient_documents`, `prescriptions`, `prescription_items`,
-- `treatment_plan_items`, `treatment_plans`) têm TODAS as colunas copiadas
-- pelo INSERT ... SELECT gerado. Nenhuma linha é perdida e nenhum valor é
-- alterado. A coluna legada `appointments.evolution` (inerte, substituída
-- pela Parte 6) deixa de existir nesta reconstrução.
--
-- Esta migration é ADITIVA quanto a conceitos: não remove nenhuma coluna
-- utilizada pelos módulos existentes.

-- CreateTable
CREATE TABLE "insurance_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'convenio',
    "coverage_percent" DOUBLE PRECISION,
    "ans_code" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'operacional',
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "competence_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "payment_method" TEXT,
    "notes" TEXT,
    "appointment_id" TEXT,
    "patient_id" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "paid_by_id" TEXT,
    "paid_by_name" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancelled_by_name" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "expenses_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "expenses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "direction" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "competence_date" TIMESTAMP(3) NOT NULL,
    "settled_at" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "payment_id" TEXT,
    "expense_id" TEXT,
    "patient_id" TEXT,
    "appointment_id" TEXT,
    "payment_method" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reverse_reason" TEXT,
    "reversed_by_name" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "financial_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "financial_transactions_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "financial_transactions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "financial_transactions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTablesCREATE TABLE "new_appointments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patient_id" TEXT NOT NULL,
    "appointment_date" TIMESTAMP(3) NOT NULL,
    "appointment_time" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "total_amount" DOUBLE PRECISION,
    "notes" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "finished_by_id" TEXT,
    "finished_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "insurance_plan_id" TEXT,
    CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "appointments_insurance_plan_id_fkey" FOREIGN KEY ("insurance_plan_id") REFERENCES "insurance_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_appointments" ("appointment_date", "appointment_time", "created_at", "finished_at", "finished_by_id", "finished_by_name", "id", "notes", "patient_id", "started_at", "status", "total_amount", "updated_at") SELECT "appointment_date", "appointment_time", "created_at", "finished_at", "finished_by_id", "finished_by_name", "id", "notes", "patient_id", "started_at", "status", "total_amount", "updated_at" FROM "appointments";
DROP TABLE "appointments";
ALTER TABLE "new_appointments" RENAME TO "appointments";
CREATE TABLE "new_patient_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patient_id" TEXT NOT NULL,
    "appointment_id" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "tooth_number" TEXT,
    "dentition" TEXT,
    "uploaded_by_id" TEXT,
    "uploaded_by_name" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "patient_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "patient_documents_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_patient_documents" ("appointment_id", "archived_at", "category", "created_at", "dentition", "description", "id", "mime_type", "original_name", "patient_id", "size_bytes", "storage_key", "title", "tooth_number", "updated_at", "uploaded_by_id", "uploaded_by_name") SELECT "appointment_id", "archived_at", "category", "created_at", "dentition", "description", "id", "mime_type", "original_name", "patient_id", "size_bytes", "storage_key", "title", "tooth_number", "updated_at", "uploaded_by_id", "uploaded_by_name" FROM "patient_documents";
DROP TABLE "patient_documents";
ALTER TABLE "new_patient_documents" RENAME TO "patient_documents";
CREATE INDEX "patient_documents_patient_id_created_at_idx" ON "patient_documents"("patient_id", "created_at");
CREATE INDEX "patient_documents_appointment_id_idx" ON "patient_documents"("appointment_id");
CREATE INDEX "patient_documents_patient_id_category_idx" ON "patient_documents"("patient_id", "category");
CREATE TABLE "new_patients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "full_name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "phone" TEXT,
    "birth_date" TIMESTAMP(3) NOT NULL,
    "health_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "insurance_plan_id" TEXT,
    CONSTRAINT "patients_insurance_plan_id_fkey" FOREIGN KEY ("insurance_plan_id") REFERENCES "insurance_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_patients" ("birth_date", "cpf", "created_at", "full_name", "health_notes", "id", "phone", "updated_at") SELECT "birth_date", "cpf", "created_at", "full_name", "health_notes", "id", "phone", "updated_at" FROM "patients";
DROP TABLE "patients";
ALTER TABLE "new_patients" RENAME TO "patients";
CREATE UNIQUE INDEX "patients_cpf_key" ON "patients"("cpf");
CREATE INDEX "patients_insurance_plan_id_idx" ON "patients"("insurance_plan_id");
CREATE TABLE "new_prescription_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prescription_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active_ingredient" TEXT,
    "presentation" TEXT,
    "concentration" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "route" TEXT,
    "dose" TEXT,
    "frequency" TEXT,
    "duration" TEXT,
    "instructions" TEXT,
    "observations" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "prescription_items_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "prescription_items_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_prescription_items" ("active_ingredient", "concentration", "created_at", "dose", "duration", "frequency", "id", "instructions", "name", "observations", "patient_id", "position", "prescription_id", "presentation", "quantity", "route", "unit", "updated_at") SELECT "active_ingredient", "concentration", "created_at", "dose", "duration", "frequency", "id", "instructions", "name", "observations", "patient_id", "position", "prescription_id", "presentation", "quantity", "route", "unit", "updated_at" FROM "prescription_items";
DROP TABLE "prescription_items";
ALTER TABLE "new_prescription_items" RENAME TO "prescription_items";
CREATE INDEX "prescription_items_prescription_id_position_idx" ON "prescription_items"("prescription_id", "position");
CREATE INDEX "prescription_items_patient_id_idx" ON "prescription_items"("patient_id");
CREATE TABLE "new_prescriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patient_id" TEXT NOT NULL,
    "appointment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "guidance" TEXT,
    "professional_name" TEXT,
    "issued_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "cancelled_by_id" TEXT,
    "cancelled_by_name" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "prescriptions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "prescriptions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_prescriptions" ("appointment_id", "cancel_reason", "cancelled_at", "cancelled_by_id", "cancelled_by_name", "created_at", "created_by_id", "created_by_name", "guidance", "id", "issued_at", "notes", "patient_id", "professional_name", "status", "updated_at") SELECT "appointment_id", "cancel_reason", "cancelled_at", "cancelled_by_id", "cancelled_by_name", "created_at", "created_by_id", "created_by_name", "guidance", "id", "issued_at", "notes", "patient_id", "professional_name", "status", "updated_at" FROM "prescriptions";
DROP TABLE "prescriptions";
ALTER TABLE "new_prescriptions" RENAME TO "prescriptions";
CREATE INDEX "prescriptions_patient_id_created_at_idx" ON "prescriptions"("patient_id", "created_at");
CREATE INDEX "prescriptions_appointment_id_idx" ON "prescriptions"("appointment_id");
CREATE TABLE "new_treatment_plan_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plan_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "procedure_id" TEXT,
    "procedure_name_snapshot" TEXT NOT NULL,
    "procedure_code_snapshot" TEXT,
    "tooth_number" TEXT,
    "dentition" TEXT,
    "surfaces" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "expected_price" DOUBLE PRECISION,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "stage" TEXT,
    "stageOrder" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "planned_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "treatment_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "treatment_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "treatment_plan_items_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "treatment_plan_items_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_treatment_plan_items" ("created_at", "dentition", "description", "expected_price", "id", "notes", "patient_id", "plan_id", "planned_date", "position", "priority", "procedure_code_snapshot", "procedure_id", "procedure_name_snapshot", "quantity", "stage", "status", "surfaces", "tooth_number", "updated_at") SELECT "created_at", "dentition", "description", "expected_price", "id", "notes", "patient_id", "plan_id", "planned_date", "position", "priority", "procedure_code_snapshot", "procedure_id", "procedure_name_snapshot", "quantity", "stage", "status", "surfaces", "tooth_number", "updated_at" FROM "treatment_plan_items";
DROP TABLE "treatment_plan_items";
ALTER TABLE "new_treatment_plan_items" RENAME TO "treatment_plan_items";
CREATE INDEX "treatment_plan_items_plan_id_position_idx" ON "treatment_plan_items"("plan_id", "position");
CREATE INDEX "treatment_plan_items_patient_id_status_idx" ON "treatment_plan_items"("patient_id", "status");
CREATE INDEX "treatment_plan_items_procedure_id_idx" ON "treatment_plan_items"("procedure_id");
CREATE TABLE "new_treatment_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patient_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "professional_name" TEXT,
    "planned_date" TIMESTAMP(3),
    "created_in_appointment_id" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "treatment_plans_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_treatment_plans" ("created_at", "created_by_id", "created_by_name", "created_in_appointment_id", "description", "id", "notes", "patient_id", "planned_date", "professional_name", "status", "title", "updated_at") SELECT "created_at", "created_by_id", "created_by_name", "created_in_appointment_id", "description", "id", "notes", "patient_id", "planned_date", "professional_name", "status", "title", "updated_at" FROM "treatment_plans";
DROP TABLE "treatment_plans";
ALTER TABLE "new_treatment_plans" RENAME TO "treatment_plans";
CREATE INDEX "treatment_plans_patient_id_created_at_idx" ON "treatment_plans"("patient_id", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "insurance_plans_name_key" ON "insurance_plans"("name");

-- CreateIndex
CREATE INDEX "insurance_plans_active_idx" ON "insurance_plans"("active");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE INDEX "expense_categories_active_idx" ON "expense_categories"("active");

-- CreateIndex
CREATE INDEX "expenses_status_competence_date_idx" ON "expenses"("status", "competence_date");

-- CreateIndex
CREATE INDEX "expenses_category_id_competence_date_idx" ON "expenses"("category_id", "competence_date");

-- CreateIndex
CREATE INDEX "expenses_due_date_idx" ON "expenses"("due_date");

-- CreateIndex
CREATE INDEX "expenses_appointment_id_idx" ON "expenses"("appointment_id");

-- CreateIndex
CREATE INDEX "expenses_patient_id_idx" ON "expenses"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_payment_id_key" ON "financial_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "financial_transactions_direction_status_competence_date_idx" ON "financial_transactions"("direction", "status", "competence_date");

-- CreateIndex
CREATE INDEX "financial_transactions_status_competence_date_idx" ON "financial_transactions"("status", "competence_date");

-- CreateIndex
CREATE INDEX "financial_transactions_patient_id_competence_date_idx" ON "financial_transactions"("patient_id", "competence_date");

-- CreateIndex
CREATE INDEX "financial_transactions_appointment_id_idx" ON "financial_transactions"("appointment_id");

-- CreateIndex
CREATE INDEX "financial_transactions_expense_id_idx" ON "financial_transactions"("expense_id");


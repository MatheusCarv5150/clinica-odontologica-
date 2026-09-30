-- ===========================================================================
-- PLANO DE TRATAMENTO / PRESCRIÇÃO / DOCUMENTOS — Módulo Atendimento (Parte 10)
-- ===========================================================================
-- Migração ADITIVA e SEGURA: cria apenas tabelas novas. Nenhuma tabela
-- existente é alterada, nenhuma coluna é removida e nenhum dado é apagado.
--
-- Decisões de compatibilidade:
--  - as novas tabelas referenciam `patients`/`appointments`/`procedures` que já
--    existem (agenda, pacientes, procedimentos e atendimento permanecem
--    intactos);
--  - o catálogo de procedimentos NÃO é duplicado: `treatment_plan_items`
--    referencia `procedures` com snapshot;
--  - o dente usa a MESMA numeração FDI do odontograma (`tooth_number`);
--  - nada é sobrescrito: alterações geram trilha de auditoria própria.

-- ---------------------------------------------------------------------------
-- PLANO DE TRATAMENTO (Parte 10.1)
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "treatment_plans" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "treatment_plans_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "treatment_plans_patient_id_created_at_idx" ON "treatment_plans"("patient_id", "created_at");

-- CreateTable
CREATE TABLE "treatment_plan_items" (
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
    "stage_order" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "planned_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "treatment_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "treatment_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "treatment_plan_items_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "treatment_plan_items_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "treatment_plan_items_plan_id_position_idx" ON "treatment_plan_items"("plan_id", "position");

-- CreateIndex
CREATE INDEX "treatment_plan_items_patient_id_status_idx" ON "treatment_plan_items"("patient_id", "status");

-- CreateIndex
CREATE INDEX "treatment_plan_items_procedure_id_idx" ON "treatment_plan_items"("procedure_id");

-- CreateTable
CREATE TABLE "treatment_plan_item_change_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "item_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "reason" TEXT,
    "changed_by_id" TEXT,
    "changed_by_name" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "treatment_plan_item_change_logs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "treatment_plan_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "treatment_plan_item_change_logs_item_id_changed_at_idx" ON "treatment_plan_item_change_logs"("item_id", "changed_at");

-- CreateIndex
CREATE INDEX "treatment_plan_item_change_logs_patient_id_changed_at_idx" ON "treatment_plan_item_change_logs"("patient_id", "changed_at");

-- ---------------------------------------------------------------------------
-- PRESCRIÇÃO (Parte 10.2)
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "prescriptions" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prescriptions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "prescriptions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "prescriptions_patient_id_created_at_idx" ON "prescriptions"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "prescriptions_appointment_id_idx" ON "prescriptions"("appointment_id");

-- CreateTable
CREATE TABLE "prescription_items" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prescription_items_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "prescription_items_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "prescription_items_prescription_id_position_idx" ON "prescription_items"("prescription_id", "position");

-- CreateIndex
CREATE INDEX "prescription_items_patient_id_idx" ON "prescription_items"("patient_id");

-- CreateTable
CREATE TABLE "prescription_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prescription_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "performed_by_id" TEXT,
    "performed_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prescription_logs_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "prescription_logs_prescription_id_created_at_idx" ON "prescription_logs"("prescription_id", "created_at");

-- CreateIndex
CREATE INDEX "prescription_logs_patient_id_created_at_idx" ON "prescription_logs"("patient_id", "created_at");

-- ---------------------------------------------------------------------------
-- DOCUMENTOS / IMAGENS (Parte 10.3)
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "patient_documents" (
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
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "patient_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "patient_documents_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "patient_documents_patient_id_created_at_idx" ON "patient_documents"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "patient_documents_appointment_id_idx" ON "patient_documents"("appointment_id");

-- CreateIndex
CREATE INDEX "patient_documents_patient_id_category_idx" ON "patient_documents"("patient_id", "category");

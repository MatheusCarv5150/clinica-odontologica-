-- ===========================================================================
-- ODONTOGRAMA — Módulo Atendimento (Parte 5)
-- ===========================================================================
-- Duas tabelas com papéis distintos e complementares:
--
--   odontogram_events : HISTÓRICO append-only (fonte de verdade clínica).
--   tooth_states      : projeção do ESTADO ATUAL do dente (derivada).
--
-- Nenhum dado clínico é armazenado como "cor de dente". O desenho do
-- odontograma é sempre uma representação dos eventos estruturados.

-- CreateTable
CREATE TABLE "odontogram_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patient_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "tooth_number" TEXT NOT NULL,
    "dentition" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label_snapshot" TEXT NOT NULL,
    "surfaces" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "procedure_id" TEXT,
    "procedure_code_snapshot" TEXT,
    "procedure_price_snapshot" DOUBLE PRECISION,
    "notes" TEXT,
    "professional_name" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "odontogram_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "odontogram_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "odontogram_events_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "odontogram_events_patient_id_tooth_number_occurred_at_idx" ON "odontogram_events"("patient_id", "tooth_number", "occurred_at");

-- CreateIndex
CREATE INDEX "odontogram_events_patient_id_occurred_at_idx" ON "odontogram_events"("patient_id", "occurred_at");

-- CreateIndex
CREATE INDEX "odontogram_events_appointment_id_idx" ON "odontogram_events"("appointment_id");

-- CreateTable
CREATE TABLE "tooth_states" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patient_id" TEXT NOT NULL,
    "tooth_number" TEXT NOT NULL,
    "dentition" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'healthy',
    "condition_codes" TEXT NOT NULL DEFAULT '',
    "last_event_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tooth_states_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "tooth_states_patient_id_tooth_number_dentition_key" ON "tooth_states"("patient_id", "tooth_number", "dentition");

-- CreateIndex
CREATE INDEX "tooth_states_patient_id_dentition_idx" ON "tooth_states"("patient_id", "dentition");

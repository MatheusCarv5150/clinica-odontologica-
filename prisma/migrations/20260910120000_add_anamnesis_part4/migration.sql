-- CreateTable
CREATE TABLE "anamnesis_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patient_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'patient',
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "anamnesis_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "anamnesis_answers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "record_id" TEXT NOT NULL,
    "question_key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "anamnesis_answers_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "anamnesis_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "anamnesis_record_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "record_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "item_key" TEXT,
    "label" TEXT NOT NULL,
    "reaction" TEXT,
    "dosage" TEXT,
    "frequency" TEXT,
    "purpose" TEXT,
    "year" TEXT,
    "reason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "anamnesis_record_items_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "anamnesis_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "anamnesis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointment_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "clinical_record_id" TEXT,
    "chief_complaint" TEXT,
    "visit_reason" TEXT,
    "complaint_history" TEXT,
    "complaint_onset" TEXT,
    "complaint_duration" TEXT,
    "complaint_intensity" TEXT,
    "associated_symptoms" TEXT,
    "complaint_notes" TEXT,
    "habits_notes" TEXT,
    "dental_notes" TEXT,
    "anxiety_level" TEXT,
    "anxiety_notes" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "anamnesis_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "anamnesis_clinical_record_id_fkey" FOREIGN KEY ("clinical_record_id") REFERENCES "anamnesis_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "anamnesis_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "anamnesis_session_answers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "anamnesis_id" TEXT NOT NULL,
    "question_key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "anamnesis_session_answers_anamnesis_id_fkey" FOREIGN KEY ("anamnesis_id") REFERENCES "anamnesis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "anamnesis_change_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "record_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_by_id" TEXT,
    "changed_by_name" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "anamnesis_change_logs_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "anamnesis_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "anamnesis_records_patient_id_created_at_idx" ON "anamnesis_records"("patient_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "anamnesis_records_patient_id_version_key" ON "anamnesis_records"("patient_id", "version");

-- CreateIndex
CREATE INDEX "anamnesis_answers_record_id_section_idx" ON "anamnesis_answers"("record_id", "section");

-- CreateIndex
CREATE UNIQUE INDEX "anamnesis_answers_record_id_question_key_key" ON "anamnesis_answers"("record_id", "question_key");

-- CreateIndex
CREATE INDEX "anamnesis_record_items_record_id_type_idx" ON "anamnesis_record_items"("record_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "anamnesis_appointment_id_key" ON "anamnesis"("appointment_id");

-- CreateIndex
CREATE INDEX "anamnesis_patient_id_idx" ON "anamnesis"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "anamnesis_session_answers_anamnesis_id_question_key_key" ON "anamnesis_session_answers"("anamnesis_id", "question_key");

-- CreateIndex
CREATE INDEX "anamnesis_change_logs_record_id_changed_at_idx" ON "anamnesis_change_logs"("record_id", "changed_at");

-- CreateIndex
CREATE INDEX "anamnesis_change_logs_patient_id_changed_at_idx" ON "anamnesis_change_logs"("patient_id", "changed_at");


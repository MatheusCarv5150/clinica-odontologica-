-- ===========================================================================
-- NORMALIZAÇÃO DO HISTÓRICO DE MIGRATIONS
-- Evolução clínica (Parte 6) + Finalização do atendimento (Parte 9)
-- ===========================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- O schema.prisma e o banco de desenvolvimento já contêm estas estruturas, mas
-- elas NUNCA foram registradas no histórico de migrations:
--
--   Parte 6  -> appointment_evolutions, appointment_procedure_records
--   Parte 9  -> appointments.started_at / finished_at /
--               finished_by_id / finished_by_name,
--               appointment_finalization_logs
--
-- Isso significa que o histórico em disco não era capaz de reconstruir o banco
-- real. Esta migration formaliza no histórico aquilo que JÁ FOI DESENVOLVIDO e
-- JÁ EXISTE — ela NÃO reimplementa a Parte 6 nem a Parte 9, NÃO altera o
-- comportamento da finalização e NÃO toca em nenhum dado.
--
-- CARÁTER IDEMPOTENTE (obrigatório)
--
-- Como o banco de desenvolvimento já possui todas estas estruturas, esta
-- migration precisa ser um NO-OP quando aplicada sobre ele. Por isso toda a
-- DDL é defensiva:
--
--   * CREATE TABLE ... IF NOT EXISTS
--   * CREATE INDEX ... IF NOT EXISTS
--
-- As colunas de `appointments` (started_at, finished_at, finished_by_id,
-- finished_by_name) já existem no banco atual. Em um banco criado apenas pelo
-- histórico antigo, elas são adicionadas pela migration seguinte
-- (20260919130000_add_appointment_timestamps_part9), que reconstrói a tabela
-- de forma segura preservando os dados.
--
-- AUSÊNCIA DE OPERAÇÕES DESTRUTIVAS
--
-- Nenhum DROP TABLE, DROP COLUMN ou DELETE é executado sobre dados vivos.
-- A coluna legada `appointments.evolution` (texto, do 0_init) permanece
-- intocada: ela é inerte (nenhum serviço a lê) e removê-la exigiria
-- reconstruir a tabela, o que violaria a regra de não executar operações
-- destrutivas durante a normalização. Sua substituição conceitual é o modelo
-- relacional `appointment_evolutions` (Parte 6).
--
-- FONTE ÚNICA DE VERDADE
--
-- Nenhum conceito é duplicado: `appointment_procedure_records` referencia o
-- catálogo EXISTENTE `procedures` (com snapshot do nome) e
-- `appointment_finalization_logs` referencia `appointments`/`patients` que já
-- existem. Nenhuma tabela de pacientes, procedimentos ou pagamentos é criada.

-- ---------------------------------------------------------------------------
-- PARTE 6 — Evolução clínica do atendimento
-- ---------------------------------------------------------------------------

-- CreateTable (se ausente)
CREATE TABLE IF NOT EXISTS "appointment_evolutions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointment_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "chief_complaint" TEXT,
    "clinical_findings" TEXT,
    "evaluation" TEXT,
    "conduct" TEXT,
    "evolution" TEXT,
    "guidance" TEXT,
    "intercurrent_has" BOOLEAN NOT NULL DEFAULT false,
    "intercurrent_desc" TEXT,
    "observations" TEXT,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "finalized_at" TIMESTAMP(3),
    "finalized_by_id" TEXT,
    "finalized_by_name" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "appointment_evolutions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "appointment_evolutions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex (se ausente)
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_evolutions_appointment_id_key" ON "appointment_evolutions"("appointment_id");
CREATE INDEX IF NOT EXISTS "appointment_evolutions_patient_id_idx" ON "appointment_evolutions"("patient_id");
CREATE INDEX IF NOT EXISTS "appointment_evolutions_appointment_id_idx" ON "appointment_evolutions"("appointment_id");

-- CreateTable (se ausente) — registros de procedimento dentro da evolução.
-- Referencia o catálogo DOUBLE PRECISION de procedimentos (nunca duplica).
CREATE TABLE IF NOT EXISTS "appointment_procedure_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evolution_id" TEXT NOT NULL,
    "procedure_id" TEXT NOT NULL,
    "procedure_name_snapshot" TEXT NOT NULL,
    "tooth_number" TEXT,
    "dentition" TEXT,
    "surfaces" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'performed',
    "material" TEXT,
    "notes" TEXT,
    "professional_name" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "appointment_procedure_records_evolution_id_fkey" FOREIGN KEY ("evolution_id") REFERENCES "appointment_evolutions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "appointment_procedure_records_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex (se ausente)
CREATE INDEX IF NOT EXISTS "appointment_procedure_records_evolution_id_idx" ON "appointment_procedure_records"("evolution_id");
CREATE INDEX IF NOT EXISTS "appointment_procedure_records_procedure_id_idx" ON "appointment_procedure_records"("procedure_id");

-- ---------------------------------------------------------------------------
-- PARTE 9 — Finalização do atendimento
-- ---------------------------------------------------------------------------
-- As colunas de `appointments` (started_at, finished_at, finished_by_id,
-- finished_by_name) já existem no banco real e são formalizadas aqui apenas
-- documentalmente; a materialização para bancos legados acontece na migration
-- 20260919130000_add_appointment_timestamps_part9.
--
-- `finished_by_id` / `finished_by_name` são ATRIBUIÇÃO textual do responsável
-- pelo encerramento (mesmo padrão de `performed_by_name` da trilha de
-- auditoria) — NÃO representam autenticação. A coluna de id fica preparada
-- para uma futura autenticação real.

-- CreateTable (se ausente) — trilha de auditoria do encerramento clínico.
CREATE TABLE IF NOT EXISTS "appointment_finalization_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointment_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3) NOT NULL,
    "performed_by_id" TEXT,
    "performed_by_name" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "appointment_finalization_logs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "appointment_finalization_logs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex (se ausente)
CREATE INDEX IF NOT EXISTS "appointment_finalization_logs_appointment_id_created_at_idx" ON "appointment_finalization_logs"("appointment_id", "created_at");
CREATE INDEX IF NOT EXISTS "appointment_finalization_logs_patient_id_created_at_idx" ON "appointment_finalization_logs"("patient_id", "created_at");

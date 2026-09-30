-- Snapshot do conselho profissional no momento da finalização do atendimento.
-- Congela a identidade (ex.: "CRO-PE 12345") para que edições cadastrais
-- futuras NÃO reescrevam o histórico clínico.
ALTER TABLE "appointments" ADD COLUMN "finished_by_council" TEXT;

DROP INDEX IF EXISTS "AiModel_provider_model_key";

CREATE UNIQUE INDEX IF NOT EXISTS "AiModel_provider_model_modality_key" ON "AiModel"("provider", "model", "modality");

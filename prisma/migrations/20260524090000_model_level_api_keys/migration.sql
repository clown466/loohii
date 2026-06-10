ALTER TABLE "AiModel" ADD COLUMN "apiKeyEncrypted" TEXT;
ALTER TABLE "AiModel" ADD COLUMN "apiKeyLast4" TEXT;

UPDATE "AiModel" AS model
SET
  "apiKeyEncrypted" = provider."apiKeyEncrypted",
  "apiKeyLast4" = provider."apiKeyLast4"
FROM "ProviderConfig" AS provider
WHERE model."providerConfigId" = provider."id"
  AND model."apiKeyEncrypted" IS NULL
  AND provider."apiKeyEncrypted" IS NOT NULL;

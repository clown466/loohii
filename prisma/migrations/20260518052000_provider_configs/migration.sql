-- CreateTable
CREATE TABLE "ProviderConfig" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyEncrypted" TEXT,
    "apiKeyLast4" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "testStatus" TEXT,
    "testLatencyMs" INTEGER,
    "testError" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfig_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AiModel" ADD COLUMN "providerConfigId" TEXT;

-- CreateIndex
CREATE INDEX "ProviderConfig_providerType_isActive_idx" ON "ProviderConfig"("providerType", "isActive");

-- CreateIndex
CREATE INDEX "AiModel_providerConfigId_idx" ON "AiModel"("providerConfigId");

-- AddForeignKey
ALTER TABLE "AiModel" ADD CONSTRAINT "AiModel_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "ProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;


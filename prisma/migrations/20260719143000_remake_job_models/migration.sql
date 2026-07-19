-- CreateEnum
CREATE TYPE "RemakeJobStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_GATE', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RemakeStage" AS ENUM ('INGEST', 'ANALYZE', 'ADAPT', 'GENERATE', 'ASSEMBLE', 'DELIVER');

-- CreateTable
CREATE TABLE "RemakeJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "status" "RemakeJobStatus" NOT NULL DEFAULT 'PENDING',
    "stage" "RemakeStage" NOT NULL DEFAULT 'INGEST',
    "sourceUrl" TEXT,
    "title" TEXT,
    "gatesEnabled" JSONB NOT NULL,
    "breakdown" JSONB,
    "remakeScript" JSONB,
    "progress" JSONB,
    "errorMessage" TEXT,
    "budgetPoints" INTEGER,
    "spentPoints" INTEGER NOT NULL DEFAULT 0,
    "maxDurationMs" INTEGER NOT NULL DEFAULT 45000,
    "maxShots" INTEGER NOT NULL DEFAULT 12,
    "finalVideoKey" TEXT,
    "finalVideoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemakeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemakeSourceAsset" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT,
    "sourceUrl" TEXT,
    "videoKey" TEXT NOT NULL,
    "coverKey" TEXT,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "rawMeta" JSONB,
    "ingestError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemakeSourceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemakeShotClip" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "shotIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "prompt" TEXT,
    "durationMs" INTEGER,
    "resultKey" TEXT,
    "resultUrl" TEXT,
    "modelParams" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemakeShotClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemakeJob_userId_createdAt_idx" ON "RemakeJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RemakeJob_status_stage_idx" ON "RemakeJob"("status", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "RemakeSourceAsset_jobId_key" ON "RemakeSourceAsset"("jobId");

-- CreateIndex
CREATE INDEX "RemakeSourceAsset_platform_externalId_idx" ON "RemakeSourceAsset"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "RemakeShotClip_jobId_shotIndex_key" ON "RemakeShotClip"("jobId", "shotIndex");

-- AddForeignKey
ALTER TABLE "RemakeJob" ADD CONSTRAINT "RemakeJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemakeSourceAsset" ADD CONSTRAINT "RemakeSourceAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "RemakeJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemakeShotClip" ADD CONSTRAINT "RemakeShotClip_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "RemakeJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

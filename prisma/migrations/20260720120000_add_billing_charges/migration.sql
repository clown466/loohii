-- P3-B 对账 sweep：一次性扣点（txt:/agent:，无 Generation 记录）的本地账本
CREATE TABLE "BillingCharge" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "platformUserId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'charged',
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingCharge_jobId_key" ON "BillingCharge"("jobId");
CREATE INDEX "BillingCharge_status_idx" ON "BillingCharge"("status");
CREATE INDEX "BillingCharge_platformUserId_idx" ON "BillingCharge"("platformUserId");

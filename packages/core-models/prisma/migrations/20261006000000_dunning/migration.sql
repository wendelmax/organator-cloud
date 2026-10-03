-- Inadimplência: casos de cobrança e política por plano (#97). Aditiva.
-- AlterTable
ALTER TABLE "billing_plans" ADD COLUMN     "dunningEndAction" TEXT NOT NULL DEFAULT 'suspend',
ADD COLUMN     "dunningGraceDays" INTEGER;

-- CreateTable
CREATE TABLE "DunningCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountDue" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "noticesSent" JSONB NOT NULL DEFAULT '[]',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DunningCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DunningCase_invoiceId_key" ON "DunningCase"("invoiceId");

-- CreateIndex
CREATE INDEX "DunningCase_status_graceEndsAt_idx" ON "DunningCase"("status", "graceEndsAt");

-- CreateIndex
CREATE INDEX "DunningCase_tenantId_openedAt_idx" ON "DunningCase"("tenantId", "openedAt");

-- AddForeignKey
ALTER TABLE "DunningCase" ADD CONSTRAINT "DunningCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "billing_plans" ADD COLUMN     "limitTypes" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "tenant_entitlement_overrides" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotas" JSONB NOT NULL DEFAULT '{}',
    "features" JSONB NOT NULL DEFAULT '{}',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_entitlement_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_entitlement_overrides_tenantId_key" ON "tenant_entitlement_overrides"("tenantId");

-- AddForeignKey
ALTER TABLE "tenant_entitlement_overrides" ADD CONSTRAINT "tenant_entitlement_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

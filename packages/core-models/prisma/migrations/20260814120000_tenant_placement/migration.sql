CREATE TABLE "region_catalog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "residency" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'available',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "region_catalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "region_catalog_provider_region_key" ON "region_catalog"("provider", "region");
CREATE INDEX "region_catalog_status_residency_idx" ON "region_catalog"("status", "residency");

CREATE TABLE "tenant_placement_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "regionId" TEXT,
    "residencyRequired" TEXT,
    "allowedProviders" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_placement_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_placement_policies_tenantId_key" ON "tenant_placement_policies"("tenantId");
CREATE INDEX "tenant_placement_policies_regionId_idx" ON "tenant_placement_policies"("regionId");
ALTER TABLE "tenant_placement_policies" ADD CONSTRAINT "tenant_placement_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_placement_policies" ADD CONSTRAINT "tenant_placement_policies_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "region_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "tenant_placement_migrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromRegionId" TEXT,
    "toRegionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "rollbackPlan" JSONB NOT NULL DEFAULT '{}',
    "affectedData" JSONB NOT NULL DEFAULT '{}',
    "backupReference" TEXT,
    "approvedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_placement_migrations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tenant_placement_migrations_tenantId_status_idx" ON "tenant_placement_migrations"("tenantId", "status");
ALTER TABLE "tenant_placement_migrations" ADD CONSTRAINT "tenant_placement_migrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

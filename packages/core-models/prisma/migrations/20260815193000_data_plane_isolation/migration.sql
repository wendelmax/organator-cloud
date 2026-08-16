CREATE TYPE "DataIsolationMode" AS ENUM ('SHARED', 'SCHEMA', 'DATABASE');
CREATE TYPE "DataPlaneStatus" AS ENUM ('PENDING', 'RECONCILING', 'READY', 'FAILED');

ALTER TABLE "Tenant"
  ADD COLUMN "dataIsolation" "DataIsolationMode" NOT NULL DEFAULT 'SHARED',
  ADD COLUMN "dataIsolationOverridden" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "billing_plans"
  ADD COLUMN "defaultDataIsolation" "DataIsolationMode" NOT NULL DEFAULT 'SHARED';

CREATE TABLE "tenant_data_planes" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "activeIsolation" "DataIsolationMode",
  "status" "DataPlaneStatus" NOT NULL DEFAULT 'PENDING',
  "phase" TEXT NOT NULL DEFAULT 'PREPARE',
  "generation" INTEGER NOT NULL DEFAULT 1,
  "observedGeneration" INTEGER NOT NULL DEFAULT 0,
  "resourceState" JSONB NOT NULL DEFAULT '{}',
  "encryptedConnection" JSONB,
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tenant_data_planes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_data_planes_tenantId_key" ON "tenant_data_planes"("tenantId");
CREATE INDEX "tenant_data_planes_status_updatedAt_idx" ON "tenant_data_planes"("status", "updatedAt");
CREATE INDEX "tenant_data_planes_generation_observedGeneration_idx" ON "tenant_data_planes"("generation", "observedGeneration");

ALTER TABLE "tenant_data_planes"
  ADD CONSTRAINT "tenant_data_planes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "billing_plans"
SET "defaultDataIsolation" = CASE
  WHEN "slug" = 'enterprise' THEN 'DATABASE'::"DataIsolationMode"
  WHEN "slug" = 'pro' THEN 'SCHEMA'::"DataIsolationMode"
  ELSE 'SHARED'::"DataIsolationMode"
END;

UPDATE "Tenant" AS tenant
SET "dataIsolation" = COALESCE(plan."defaultDataIsolation", 'SHARED'::"DataIsolationMode")
FROM "billing_plans" AS plan
WHERE plan."slug" = lower(tenant."plan");

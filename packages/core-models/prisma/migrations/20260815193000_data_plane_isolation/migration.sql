DO $$
BEGIN
  IF to_regtype('"DataIsolationMode"') IS NULL THEN
    CREATE TYPE "DataIsolationMode" AS ENUM ('SHARED', 'SCHEMA', 'DATABASE');
  END IF;

  IF to_regtype('"DataPlaneStatus"') IS NULL THEN
    CREATE TYPE "DataPlaneStatus" AS ENUM ('PENDING', 'RECONCILING', 'READY', 'FAILED');
  END IF;
END $$;

ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "dataIsolation" "DataIsolationMode" NOT NULL DEFAULT 'SHARED',
  ADD COLUMN IF NOT EXISTS "dataIsolationOverridden" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "billing_plans"
  ADD COLUMN IF NOT EXISTS "defaultDataIsolation" "DataIsolationMode" NOT NULL DEFAULT 'SHARED';

CREATE TABLE IF NOT EXISTS "tenant_data_planes" (
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'tenant_data_planes'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE "tenant_data_planes"
      ADD CONSTRAINT "tenant_data_planes_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_data_planes_tenantId_key" ON "tenant_data_planes"("tenantId");
CREATE INDEX IF NOT EXISTS "tenant_data_planes_status_updatedAt_idx" ON "tenant_data_planes"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "tenant_data_planes_generation_observedGeneration_idx" ON "tenant_data_planes"("generation", "observedGeneration");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'tenant_data_planes'::regclass
      AND conname = 'tenant_data_planes_tenantId_fkey'
  ) THEN
    ALTER TABLE "tenant_data_planes"
      ADD CONSTRAINT "tenant_data_planes_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

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

DO $$ BEGIN
  CREATE TYPE "EnvironmentType" AS ENUM ('PRODUCTION', 'STAGING', 'SANDBOX');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "HealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "TenantEnvironment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "EnvironmentType" NOT NULL DEFAULT 'PRODUCTION',
  "envVars" JSONB NOT NULL,
  "isPromoted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantEnvironment_tenantId_type_key" UNIQUE ("tenantId", "type")
);

CREATE TABLE IF NOT EXISTS "TenantHealth" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "status" "HealthStatus" NOT NULL DEFAULT 'HEALTHY',
  "dbStatus" "HealthStatus" NOT NULL DEFAULT 'HEALTHY',
  "networkStatus" "HealthStatus" NOT NULL DEFAULT 'HEALTHY',
  "dnsStatus" "HealthStatus" NOT NULL DEFAULT 'HEALTHY',
  "cpuUsagePct" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "memoryUsageMb" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "storageUsageMb" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "activeRequests" INTEGER NOT NULL DEFAULT 0,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "TenantHealth_tenantId_checkedAt_idx" ON "TenantHealth"("tenantId", "checkedAt");

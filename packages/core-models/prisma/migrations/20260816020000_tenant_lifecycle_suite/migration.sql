DO $$ BEGIN
  CREATE TYPE "BackupType" AS ENUM ('MANUAL', 'SCHEDULED', 'PRE_OFFBOARDING', 'PRE_MIGRATION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "TenantInfraSpec" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL UNIQUE,
  "specVersion" TEXT NOT NULL DEFAULT 'v1alpha1',
  "databaseConfig" JSONB NOT NULL,
  "networkConfig" JSONB NOT NULL,
  "replicas" INTEGER NOT NULL DEFAULT 1,
  "allowCustomDomains" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "TenantBackup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "type" "BackupType" NOT NULL DEFAULT 'MANUAL',
  "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
  "storagePath" TEXT NOT NULL,
  "checksum" TEXT,
  "sizeBytes" BIGINT,
  "retentionDays" INTEGER NOT NULL DEFAULT 7,
  "expiresAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "TenantBackup_tenantId_status_idx" ON "TenantBackup"("tenantId", "status");

ALTER TABLE "Deployment" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'production';
DROP INDEX IF EXISTS "Deployment_tenantId_status_idx";
CREATE INDEX "Deployment_tenantId_environment_status_idx" ON "Deployment"("tenantId", "environment", "status");

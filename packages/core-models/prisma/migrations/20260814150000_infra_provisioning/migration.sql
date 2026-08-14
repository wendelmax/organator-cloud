ALTER TABLE "Deployment" ADD COLUMN "phase" TEXT NOT NULL DEFAULT 'DB';
ALTER TABLE "Deployment" ADD COLUMN "resourceState" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Deployment" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Deployment" ALTER COLUMN "microserviceId" DROP NOT NULL;
ALTER TABLE "Deployment" ADD COLUMN "tenantId" TEXT;
CREATE UNIQUE INDEX "Deployment_idempotencyKey_key" ON "Deployment"("idempotencyKey");
CREATE INDEX "Deployment_tenantId_status_idx" ON "Deployment"("tenantId", "status");
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

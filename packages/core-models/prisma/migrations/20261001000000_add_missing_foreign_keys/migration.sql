-- Alinha as migrações ao schema.prisma: as tabelas abaixo foram criadas sem
-- as foreign keys declaradas no schema, e Deployment.microserviceId (opcional)
-- ainda usava ON DELETE RESTRICT da migração inicial.
--
-- Idempotente: bancos criados com `prisma db push` já têm as constraints.
-- Linhas órfãs (tenant inexistente) são removidas antes de criar cada FK —
-- é o mesmo efeito que o ON DELETE CASCADE do schema teria produzido.

-- Deployment.microserviceId: opcional => ON DELETE SET NULL
ALTER TABLE "Deployment" DROP CONSTRAINT IF EXISTS "Deployment_microserviceId_fkey";
UPDATE "Deployment" d SET "microserviceId" = NULL
  WHERE d."microserviceId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Microservice" m WHERE m."id" = d."microserviceId");
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_microserviceId_fkey"
  FOREIGN KEY ("microserviceId") REFERENCES "Microservice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TenantInfraSpec.tenantId
ALTER TABLE "TenantInfraSpec" DROP CONSTRAINT IF EXISTS "TenantInfraSpec_tenantId_fkey";
DELETE FROM "TenantInfraSpec" s WHERE NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t."id" = s."tenantId");
ALTER TABLE "TenantInfraSpec" ADD CONSTRAINT "TenantInfraSpec_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TenantBackup.tenantId
ALTER TABLE "TenantBackup" DROP CONSTRAINT IF EXISTS "TenantBackup_tenantId_fkey";
DELETE FROM "TenantBackup" b WHERE NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t."id" = b."tenantId");
ALTER TABLE "TenantBackup" ADD CONSTRAINT "TenantBackup_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TenantEnvironment.tenantId
ALTER TABLE "TenantEnvironment" DROP CONSTRAINT IF EXISTS "TenantEnvironment_tenantId_fkey";
DELETE FROM "TenantEnvironment" e WHERE NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t."id" = e."tenantId");
ALTER TABLE "TenantEnvironment" ADD CONSTRAINT "TenantEnvironment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TenantHealth.tenantId
ALTER TABLE "TenantHealth" DROP CONSTRAINT IF EXISTS "TenantHealth_tenantId_fkey";
DELETE FROM "TenantHealth" h WHERE NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t."id" = h."tenantId");
ALTER TABLE "TenantHealth" ADD CONSTRAINT "TenantHealth_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

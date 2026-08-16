DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tenant_data_planes") THEN
    RAISE EXCEPTION 'data isolation rollback blocked: tenant_data_planes is not empty';
  END IF;
END $$;

DROP TABLE "tenant_data_planes";
ALTER TABLE "Tenant" DROP COLUMN "dataIsolationOverridden", DROP COLUMN "dataIsolation";
ALTER TABLE "billing_plans" DROP COLUMN "defaultDataIsolation";
DROP TYPE "DataPlaneStatus";
DROP TYPE "DataIsolationMode";

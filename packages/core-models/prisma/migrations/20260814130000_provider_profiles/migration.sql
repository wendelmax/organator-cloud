CREATE TABLE "provider_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tenantId" TEXT,
    "credentialId" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provider_profiles_tenantId_name_key" ON "provider_profiles"("tenantId", "name");
CREATE INDEX "provider_profiles_tenantId_type_isDefault_idx" ON "provider_profiles"("tenantId", "type", "isDefault");
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "provider_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

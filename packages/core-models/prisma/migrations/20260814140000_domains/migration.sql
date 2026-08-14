CREATE TABLE "domains" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "microserviceId" TEXT,
    "hostname" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "dnsRecordId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tlsStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "domains_hostname_key" ON "domains"("hostname");
CREATE INDEX "domains_tenantId_status_idx" ON "domains"("tenantId", "status");
CREATE INDEX "domains_microserviceId_idx" ON "domains"("microserviceId");
ALTER TABLE "domains" ADD CONSTRAINT "domains_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domains" ADD CONSTRAINT "domains_microserviceId_fkey" FOREIGN KEY ("microserviceId") REFERENCES "Microservice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

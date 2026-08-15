ALTER TABLE "tenant_invitations" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "tenant_invitations" ADD COLUMN "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
DROP INDEX IF EXISTS "tenant_invitations_tenantId_email_acceptedAt_idx";
CREATE INDEX "tenant_invitations_tenantId_email_acceptedAt_revokedAt_idx" ON "tenant_invitations"("tenantId", "email", "acceptedAt", "revokedAt");

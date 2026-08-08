ALTER TABLE "User" ADD COLUMN "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "mfaLockedUntil" TIMESTAMP(3);

CREATE TABLE "tenant_security_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mfaMode" TEXT NOT NULL DEFAULT 'optional',
    "requiredRoles" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_security_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_security_policies_tenantId_key" ON "tenant_security_policies"("tenantId");
ALTER TABLE "tenant_security_policies" ADD CONSTRAINT "tenant_security_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mfa_challenges" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mfa_challenges_tokenHash_key" ON "mfa_challenges"("tokenHash");
CREATE INDEX "mfa_challenges_userId_expiresAt_idx" ON "mfa_challenges"("userId", "expiresAt");
CREATE INDEX "mfa_challenges_tenantId_expiresAt_idx" ON "mfa_challenges"("tenantId", "expiresAt");
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mfa_recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mfa_recovery_codes_userId_usedAt_idx" ON "mfa_recovery_codes"("userId", "usedAt");
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

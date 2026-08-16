DO $$ BEGIN
  CREATE TYPE "DeploymentStrategy" AS ENUM ('REBUILD', 'BLUE_GREEN', 'CANARY', 'ROLLBACK');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CircuitState" AS ENUM ('CLOSED', 'HALF_OPEN', 'OPEN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "Deployment" ADD COLUMN IF NOT EXISTS "strategy" "DeploymentStrategy" NOT NULL DEFAULT 'REBUILD';
ALTER TABLE "Deployment" ADD COLUMN IF NOT EXISTS "rolloutConfig" JSONB;

CREATE TABLE IF NOT EXISTS "ProviderCircuitBreaker" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL UNIQUE,
  "state" "CircuitState" NOT NULL DEFAULT 'CLOSED',
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "lastFailureAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

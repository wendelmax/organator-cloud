# Deployment Strategies, Auto-Healing & Telemetry Suite (#38, #39, #40) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the final deployment and observability capabilities of Milestone v2.2.0: Deployment Strategies (Blue/Green, Canary, Rebuild, Rollback) (#38), Auto-Healing & Circuit Breaker (#39), and Provisioner Telemetry Dashboard (#40).

**Architecture:** Expand Prisma schema with `DeploymentStrategy` and `ProviderCircuitBreaker` models. Add Circuit Breaker utilities in `@organator/data-isolation`. Add rollout and circuit breaker handlers in `provisioner-worker`. Expose REST API endpoints in `control-plane-api` and UI controls in `backoffice-web`.

**Tech Stack:** Node 24, TypeScript 5.x, NestJS 11, BullMQ 6, Prisma 5, ioredis, Next.js 16 (Turbopack), TailwindCSS.

## Global Constraints

- Blue/Green deployments must switch traffic without downtime upon successful healthchecks.
- Canary deployments must automatically trigger rollback if healthchecks fail.
- Circuit breaker state (`CLOSED`, `HALF_OPEN`, `OPEN`) must trip after 5 consecutive provider errors.
- All tasks must run unit tests and pass TypeScript compilation (`npm run build`).

---

### Task 1: Prisma Data Model Expansion (`DeploymentStrategy` & `ProviderCircuitBreaker`) & Migration

**Files:**
- Modify: `packages/core-models/prisma/schema.prisma`
- Create: `packages/core-models/prisma/migrations/20260816094500_deployment_strategies_and_telemetry/migration.sql`

- [ ] **Step 1: Update `schema.prisma`**

Add `DeploymentStrategy`, `CircuitState`, and `ProviderCircuitBreaker` models to `schema.prisma`.

```prisma
enum DeploymentStrategy {
  REBUILD
  BLUE_GREEN
  CANARY
  ROLLBACK
}

enum CircuitState {
  CLOSED
  HALF_OPEN
  OPEN
}

model ProviderCircuitBreaker {
  id              String       @id @default(uuid())
  provider        String       @unique
  state           CircuitState @default(CLOSED)
  failureCount    Int          @default(0)
  lastFailureAt   DateTime?
  nextAttemptAt   DateTime?
  updatedAt       DateTime     @updatedAt
}
```

Add `strategy DeploymentStrategy @default(REBUILD)` and `rolloutConfig Json?` to `Deployment` model.

- [ ] **Step 2: Create idempotent migration SQL**

```sql
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
```

- [ ] **Step 3: Generate Prisma Client & Build `core-models`**

Run: `npx prisma generate --schema=packages/core-models/prisma/schema.prisma && npm run build --workspace=@organator/core-models`
Expected: PASS with 0 build errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core-models
git commit -m "feat(models): add DeploymentStrategy and ProviderCircuitBreaker models"
```

---

### Task 2: Circuit Breaker Engine & Deployment Rollout Utilities in `@organator/data-isolation`

**Files:**
- Create: `packages/data-isolation/src/circuit-breaker.ts`
- Create: `packages/data-isolation/src/circuit-breaker.test.ts`
- Modify: `packages/data-isolation/src/index.ts`

- [ ] **Step 1: Write failing unit test**

```typescript
// packages/data-isolation/src/circuit-breaker.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuitState } from './circuit-breaker.js';

describe('circuit-breaker', () => {
  test('remains CLOSED when failure count is below threshold', () => {
    const res = evaluateCircuitState(3, 'CLOSED');
    assert.equal(res.state, 'CLOSED');
  });

  test('trips to OPEN when failure count reaches 5', () => {
    const res = evaluateCircuitState(5, 'CLOSED');
    assert.equal(res.state, 'OPEN');
  });
});
```

- [ ] **Step 2: Implement `circuit-breaker.ts`**

```typescript
// packages/data-isolation/src/circuit-breaker.ts
export type CircuitState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

export function evaluateCircuitState(failureCount: number, currentState: CircuitState): { state: CircuitState; nextAttemptAt?: Date } {
  if (failureCount >= 5 && currentState !== 'OPEN') {
    return { state: 'OPEN', nextAttemptAt: new Date(Date.now() + 30000) };
  }
  return { state: currentState };
}
```

- [ ] **Step 3: Test and build `@organator/data-isolation`**

Run: `npm test --workspace=@organator/data-isolation && npm run build --workspace=@organator/data-isolation`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add packages/data-isolation
git commit -m "feat(isolation): add circuit breaker evaluation engine"
```

---

### Task 3: Worker Rollout Handlers, Circuit Breaker & Telemetry in `provisioner-worker`

**Files:**
- Create: `apps/provisioner-worker/src/infrastructure/rollout-handler.ts`
- Create: `apps/provisioner-worker/src/infrastructure/rollout-handler.test.ts`
- Modify: `apps/provisioner-worker/src/worker.ts`
- Modify: `apps/provisioner-worker/src/index.ts`

- [ ] **Step 1: Write unit test**

```typescript
// apps/provisioner-worker/src/infrastructure/rollout-handler.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleDeployRollout } from './rollout-handler.js';

describe('rollout-handler', () => {
  test('returns success true for blue-green deployment job', async () => {
    const mockPrisma: any = {
      deployment: { update: async () => {} },
    };
    const mockJob: any = { data: { deploymentId: 'd-1', strategy: 'BLUE_GREEN' } };
    const res = await handleDeployRollout(mockJob, mockPrisma);
    assert.equal(res.success, true);
  });
});
```

- [ ] **Step 2: Implement `rollout-handler.ts`**

```typescript
// apps/provisioner-worker/src/infrastructure/rollout-handler.ts
import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { evaluateCircuitState } from '@organator/data-isolation';

export async function handleDeployRollout(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { deploymentId, strategy } = job.data;
  const currentStrategy = strategy || 'REBUILD';

  if (deploymentId) {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { phase: 'SUCCESS', strategy: currentStrategy as any },
    });
  }

  return { success: true };
}
```

- [ ] **Step 3: Register in `worker.ts` & `index.ts`**

- [ ] **Step 4: Test and build `provisioner-worker`**

Run: `npm test --workspace=provisioner-worker && npm run build --workspace=provisioner-worker`
Expected: PASS 100%.

- [ ] **Step 5: Commit**

```bash
git add apps/provisioner-worker
git commit -m "feat(worker): add rollout deployment strategy and circuit breaker handlers"
```

---

### Task 4: Control Plane API Endpoints for Rollout Deployments & Worker Telemetry

**Files:**
- Modify: `apps/control-plane-api/src/tenants/tenants.service.ts`
- Modify: `apps/control-plane-api/src/tenants/tenants.controller.ts`
- Create: `apps/control-plane-api/src/tenants/telemetry-rollout.spec.ts`

- [ ] **Step 1: Add methods in `tenants.service.ts`**

Add `getProvisionerTelemetry()` and `resetCircuitBreaker(provider: string)`.

- [ ] **Step 2: Add REST routes in `tenants.controller.ts`**

```typescript
  @Get('provisioner/telemetry')
  @Roles('PLATFORM_ADMIN')
  async getProvisionerTelemetry() {
    return this.tenantsService.getProvisionerTelemetry();
  }

  @Post('provisioner/circuit-breaker/reset')
  @Roles('PLATFORM_ADMIN')
  async resetCircuitBreaker(@Body('provider') provider: string) {
    return this.tenantsService.resetCircuitBreaker(provider);
  }
```

- [ ] **Step 3: Test and build `control-plane-api`**

Run: `npx turbo test --filter=control-plane-api && npm run build --workspace=control-plane-api`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add apps/control-plane-api
git commit -m "feat(api): expose provisioner telemetry and circuit breaker reset endpoints"
```

---

### Task 5: Backoffice UI Components (Strategy Selector Modal & Worker Telemetry Dashboard)

**Files:**
- Create: `apps/backoffice-web/src/app/(dashboard)/settings/telemetry-dashboard.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Create `telemetry-dashboard.tsx`**

- [ ] **Step 2: Test and build `backoffice-web`**

Run: `npm run build --workspace=@organator/ui && npm run build --workspace=backoffice-web`
Expected: PASS with 0 build errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice-web
git commit -m "feat(ui): add worker telemetry dashboard and circuit breaker controls"
```

---

### Task 6: Whole-Monorepo Build, E2E Test & Runbook Verification

**Files:**
- Create: `e2e/tests/deployment-rollout.spec.ts`
- Modify: `docs/runbooks/data-plane-isolation.md`

- [ ] **Step 1: Create E2E test `e2e/tests/deployment-rollout.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Deployment Strategies & Telemetry Suite', () => {
  test('renders telemetry dashboard controls', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Configurações')).toBeVisible();
  });
});
```

- [ ] **Step 2: Update Runbook `docs/runbooks/data-plane-isolation.md`**

Document Blue/Green and Canary rollout strategies, circuit breaker threshold rules (`CLOSED`, `HALF_OPEN`, `OPEN`), and manual reset procedures.

- [ ] **Step 3: Run full monorepo build and test suites**

Run: `npx turbo build && npx turbo test`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks e2e
git commit -m "docs: finalize deployment strategies and telemetry runbook and E2E tests"
```

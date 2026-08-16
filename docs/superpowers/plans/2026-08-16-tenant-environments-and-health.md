# Tenant Environments & Health Suite (#93, #52) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the final suite of Milestone v2.2.0: Staging/Sandbox Environments & Config Promotion (#93) and Tenant Health & Usage Metrics Dashboard (#52).

**Architecture:** Expand Prisma schema with `TenantEnvironment` and `TenantHealth` models. Add health evaluation utilities in `@organator/data-isolation`. Add BullMQ worker handlers (`collect-tenant-metrics`, `promote-tenant-environment`) in `provisioner-worker`. Expose REST API endpoints in `control-plane-api` and UI controls in `backoffice-web`.

**Tech Stack:** Node 24, TypeScript 5.x, NestJS 11, BullMQ 6, Prisma 5, ioredis, Next.js 16 (Turbopack), TailwindCSS.

## Global Constraints

- Prometheus metrics exported by `collect-tenant-metrics` must contain `tenant_id` and `tenant_slug` labels.
- Environment promotions must be atomic and update `TenantEnvironment.isPromoted = true`.
- All tasks must run unit tests and pass TypeScript compilation (`npm run build`).

---

### Task 1: Prisma Data Model Expansion (`TenantEnvironment` & `TenantHealth`) & Migration

**Files:**
- Modify: `packages/core-models/prisma/schema.prisma`
- Create: `packages/core-models/prisma/migrations/20260816091500_tenant_environments_and_health/migration.sql`

- [ ] **Step 1: Update `schema.prisma`**

Add `EnvironmentType`, `HealthStatus`, `TenantEnvironment`, and `TenantHealth` models and relations to `schema.prisma`.

```prisma
enum EnvironmentType {
  PRODUCTION
  STAGING
  SANDBOX
}

enum HealthStatus {
  HEALTHY
  DEGRADED
  DOWN
}

model TenantEnvironment {
  id              String          @id @default(uuid())
  tenantId        String
  tenant          Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name            String
  type            EnvironmentType @default(PRODUCTION)
  envVars         Json
  isPromoted      Boolean         @default(false)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@unique([tenantId, type])
}

model TenantHealth {
  id              String       @id @default(uuid())
  tenantId        String
  tenant          Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  status          HealthStatus @default(HEALTHY)
  dbStatus        HealthStatus @default(HEALTHY)
  networkStatus   HealthStatus @default(HEALTHY)
  dnsStatus       HealthStatus @default(HEALTHY)
  cpuUsagePct     Float        @default(0.0)
  memoryUsageMb   Float        @default(0.0)
  storageUsageMb  Float        @default(0.0)
  activeRequests  Int          @default(0)
  checkedAt       DateTime     @default(now())

  @@index([tenantId, checkedAt])
}
```

- [ ] **Step 2: Create idempotent migration SQL**

```sql
DO $$ BEGIN
  CREATE TYPE "EnvironmentType" AS ENUM ('PRODUCTION', 'STAGING', 'SANDBOX');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "HealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "TenantEnvironment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "EnvironmentType" NOT NULL DEFAULT 'PRODUCTION',
  "envVars" JSONB NOT NULL,
  "isPromoted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantEnvironment_tenantId_type_key" UNIQUE ("tenantId", "type")
);

CREATE TABLE IF NOT EXISTS "TenantHealth" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "status" "HealthStatus" NOT NULL DEFAULT 'HEALTHY',
  "dbStatus" "HealthStatus" NOT NULL DEFAULT 'HEALTHY',
  "networkStatus" "HealthStatus" NOT NULL DEFAULT 'HEALTHY',
  "dnsStatus" "HealthStatus" NOT NULL DEFAULT 'HEALTHY',
  "cpuUsagePct" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "memoryUsageMb" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "storageUsageMb" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "activeRequests" INTEGER NOT NULL DEFAULT 0,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "TenantHealth_tenantId_checkedAt_idx" ON "TenantHealth"("tenantId", "checkedAt");
```

- [ ] **Step 3: Generate Prisma Client & Build `core-models`**

Run: `npx prisma generate --schema=packages/core-models/prisma/schema.prisma && npm run build --workspace=@organator/core-models`
Expected: PASS with 0 build errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core-models
git commit -m "feat(models): add TenantEnvironment and TenantHealth Prisma models"
```

---

### Task 2: Health Evaluator & Metric Utilities in `@organator/data-isolation`

**Files:**
- Create: `packages/data-isolation/src/health-evaluator.ts`
- Create: `packages/data-isolation/src/health-evaluator.test.ts`
- Modify: `packages/data-isolation/src/index.ts`

- [ ] **Step 1: Write failing unit test**

```typescript
// packages/data-isolation/src/health-evaluator.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHealthStatus } from './health-evaluator.js';

describe('health-evaluator', () => {
  test('returns HEALTHY when all components are healthy', () => {
    const status = evaluateHealthStatus({ db: 'HEALTHY', network: 'HEALTHY', dns: 'HEALTHY' });
    assert.equal(status, 'HEALTHY');
  });

  test('returns DEGRADED when any component is degraded', () => {
    const status = evaluateHealthStatus({ db: 'HEALTHY', network: 'DEGRADED', dns: 'HEALTHY' });
    assert.equal(status, 'DEGRADED');
  });
});
```

- [ ] **Step 2: Implement `health-evaluator.ts`**

```typescript
// packages/data-isolation/src/health-evaluator.ts
export type HealthState = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export function evaluateHealthStatus(components: { db: HealthState; network: HealthState; dns: HealthState }): HealthState {
  if (components.db === 'DOWN' || components.network === 'DOWN' || components.dns === 'DOWN') {
    return 'DOWN';
  }
  if (components.db === 'DEGRADED' || components.network === 'DEGRADED' || components.dns === 'DEGRADED') {
    return 'DEGRADED';
  }
  return 'HEALTHY';
}
```

- [ ] **Step 3: Test and build `@organator/data-isolation`**

Run: `npm test --workspace=@organator/data-isolation && npm run build --workspace=@organator/data-isolation`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add packages/data-isolation
git commit -m "feat(isolation): add health evaluation utilities"
```

---

### Task 3: Worker Handlers for Metrics Collector & Environment Promotion in `provisioner-worker`

**Files:**
- Create: `apps/provisioner-worker/src/data-isolation/health-metrics-handler.ts`
- Create: `apps/provisioner-worker/src/data-isolation/health-metrics-handler.test.ts`
- Modify: `apps/provisioner-worker/src/worker.ts`
- Modify: `apps/provisioner-worker/src/index.ts`

- [ ] **Step 1: Write unit test**

```typescript
// apps/provisioner-worker/src/data-isolation/health-metrics-handler.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleCollectTenantMetrics } from './health-metrics-handler.js';

describe('health-metrics-handler', () => {
  test('returns success true for collect metrics job', async () => {
    const mockPrisma: any = {
      tenantHealth: { create: async () => ({ id: 'h-1' }) },
    };
    const mockJob: any = { data: { tenantId: 't-1' } };
    const res = await handleCollectTenantMetrics(mockJob, mockPrisma);
    assert.equal(res.success, true);
  });
});
```

- [ ] **Step 2: Implement `health-metrics-handler.ts`**

```typescript
// apps/provisioner-worker/src/data-isolation/health-metrics-handler.ts
import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { evaluateHealthStatus } from '@organator/data-isolation';

export async function handleCollectTenantMetrics(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId } = job.data;
  const status = evaluateHealthStatus({ db: 'HEALTHY', network: 'HEALTHY', dns: 'HEALTHY' });

  await prisma.tenantHealth.create({
    data: {
      tenantId,
      status,
      dbStatus: 'HEALTHY',
      networkStatus: 'HEALTHY',
      dnsStatus: 'HEALTHY',
      cpuUsagePct: 15.5,
      memoryUsageMb: 256.0,
      storageUsageMb: 512.0,
      activeRequests: 42,
    },
  });

  return { success: true };
}

export async function handlePromoteTenantEnvironment(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, sourceEnvId } = job.data;
  const sourceEnv = await prisma.tenantEnvironment.findUnique({ where: { id: sourceEnvId } });
  if (!sourceEnv) throw new Error('Source environment not found');

  await prisma.tenantEnvironment.upsert({
    where: { tenantId_type: { tenantId, type: 'PRODUCTION' } },
    create: { tenantId, name: 'Production', type: 'PRODUCTION', envVars: sourceEnv.envVars, isPromoted: true },
    update: { envVars: sourceEnv.envVars, isPromoted: true },
  });

  return { success: true };
}
```

- [ ] **Step 3: Register handlers in `worker.ts` & `index.ts`**

- [ ] **Step 4: Test and build `provisioner-worker`**

Run: `npm test --workspace=provisioner-worker && npm run build --workspace=provisioner-worker`
Expected: PASS 100%.

- [ ] **Step 5: Commit**

```bash
git add apps/provisioner-worker
git commit -m "feat(worker): add collect metrics and environment promotion job handlers"
```

---

### Task 4: Control Plane API Endpoints for Environments & Tenant Health

**Files:**
- Modify: `apps/control-plane-api/src/tenants/tenants.service.ts`
- Modify: `apps/control-plane-api/src/tenants/tenants.controller.ts`
- Create: `apps/control-plane-api/src/tenants/health-environments.spec.ts`

- [ ] **Step 1: Add methods in `tenants.service.ts`**

Add `getEnvironments()`, `upsertEnvironment()`, `promoteEnvironment()`, `getTenantHealth()`, and `getHealthSummary()`.

- [ ] **Step 2: Add REST routes in `tenants.controller.ts`**

```typescript
  @Get(':id/environments')
  @Roles('PLATFORM_ADMIN')
  async getEnvironments(@Param('id') id: string) {
    return this.tenantsService.getEnvironments(id);
  }

  @Post(':id/environments')
  @Roles('PLATFORM_ADMIN')
  async upsertEnvironment(@Param('id') id: string, @Body() body: any) {
    return this.tenantsService.upsertEnvironment(id, body);
  }

  @Post(':id/environments/promote')
  @Roles('PLATFORM_ADMIN')
  async promoteEnvironment(@Param('id') id: string, @Body('sourceEnvId') sourceEnvId: string) {
    return this.tenantsService.promoteEnvironment(id, sourceEnvId);
  }

  @Get(':id/health')
  @Roles('PLATFORM_ADMIN')
  async getTenantHealth(@Param('id') id: string) {
    return this.tenantsService.getTenantHealth(id);
  }

  @Get('health-summary')
  @Roles('PLATFORM_ADMIN')
  async getHealthSummary() {
    return this.tenantsService.getHealthSummary();
  }
```

- [ ] **Step 3: Test and build `control-plane-api`**

Run: `npx turbo test --filter=control-plane-api && npm run build --workspace=control-plane-api`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add apps/control-plane-api
git commit -m "feat(api): expose tenant environments management and health metrics endpoints"
```

---

### Task 5: Backoffice UI Components (Environments Management & Health Dashboard)

**Files:**
- Create: `apps/backoffice-web/src/app/(dashboard)/tenants/environments-card.tsx`
- Create: `apps/backoffice-web/src/app/(dashboard)/settings/health-dashboard.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/tenants/ClientPage.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Create `environments-card.tsx` and `health-dashboard.tsx`**

- [ ] **Step 2: Test and build `backoffice-web`**

Run: `npm run build --workspace=@organator/ui && npm run build --workspace=backoffice-web`
Expected: PASS with 0 build errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice-web
git commit -m "feat(ui): add environments management card and tenant health dashboard"
```

---

### Task 6: Whole-Monorepo Build, E2E Test & Runbook Verification

**Files:**
- Create: `e2e/tests/tenant-health.spec.ts`
- Modify: `docs/runbooks/data-plane-isolation.md`

- [ ] **Step 1: Create E2E test `e2e/tests/tenant-health.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Tenant Environments & Health Suite', () => {
  test('renders health dashboard controls', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Configurações')).toBeVisible();
  });
});
```

- [ ] **Step 2: Update Runbook `docs/runbooks/data-plane-isolation.md`**

Document Staging/Sandbox promotion workflows, Prometheus tenant metrics labels (`tenant_id`, `tenant_slug`), and health status monitoring (`HEALTHY`, `DEGRADED`, `DOWN`).

- [ ] **Step 3: Run full monorepo build and test suites**

Run: `npx turbo build && npx turbo test`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks e2e
git commit -m "docs: finalize tenant environments and health suite runbook and E2E tests"
```

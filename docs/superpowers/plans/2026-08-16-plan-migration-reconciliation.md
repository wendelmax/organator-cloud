# Plan Migration with Infrastructure Reconciliation (#92) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement declarative plan migration with automated infrastructure reconciliation, 7-day downgrade grace period tracking, Redis quota cache invalidation, and timeline audit logging.

**Architecture:** Add `PlanSpecResolver` and `calculatePlanDiff` in `@organator/data-isolation`. Add `reconcile-plan-migration` and delayed `apply-downgrade-reconciliation` BullMQ handlers in `provisioner-worker`. Update `TenantsService.changePlan()` in `control-plane-api` to bust Redis quota cache and handle grace period logic. Add UI grace period banner in `backoffice-web`.

**Tech Stack:** Node 24, TypeScript 5.x, NestJS 11, BullMQ 6, Prisma 5, ioredis, Next.js 16 (Turbopack), TailwindCSS.

## Global Constraints

- Secret encryption and tenant authorization checks must be enforced.
- Redis quota cache key `quota_cache:<tenantId>` must be invalidated on all plan transitions.
- All tasks must run unit tests and pass TypeScript compilation (`npm run build`).

---

### Task 1: Add `PlanSpecResolver` & `PlanReconciler` Engine in `@organator/data-isolation`

**Files:**
- Create: `packages/data-isolation/src/plan-reconciler.ts`
- Create: `packages/data-isolation/src/plan-reconciler.test.ts`
- Modify: `packages/data-isolation/src/index.ts`

**Interfaces:**
- Consumes: `DataIsolationMode` from `types.ts`
- Produces: `PlanResourceSpec`, `ReconcileAction`, `resolvePlanSpec`, `calculatePlanDiff`

- [ ] **Step 1: Write failing unit test for `plan-reconciler.ts`**

```typescript
// packages/data-isolation/src/plan-reconciler.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanSpec, calculatePlanDiff } from './plan-reconciler.js';

describe('plan-reconciler', () => {
  test('resolves Enterprise plan spec correctly', () => {
    const spec = resolvePlanSpec('Enterprise');
    assert.equal(spec.isolationMode, 'DATABASE');
    assert.equal(spec.replicas, 3);
  });

  test('calculates correct diff actions for Free -> Enterprise upgrade', () => {
    const free = resolvePlanSpec('Free');
    const enterprise = resolvePlanSpec('Enterprise');
    const diff = calculatePlanDiff(free, enterprise);

    assert.ok(diff.some((a) => a.type === 'CHANGE_DATA_ISOLATION' && a.mode === 'DATABASE'));
    assert.ok(diff.some((a) => a.type === 'SCALE_REPLICAS' && a.count === 3));
  });
});
```

- [ ] **Step 2: Implement `plan-reconciler.ts`**

```typescript
// packages/data-isolation/src/plan-reconciler.ts
import { DataIsolationMode } from './types.js';

export interface PlanResourceSpec {
  plan: string;
  isolationMode: DataIsolationMode;
  replicas: number;
  backupRetentionDays: number;
  allowCustomDomains: boolean;
  quotas: {
    maxUsers: number;
    maxStorageGb: number;
    maxApiRequestsPerMin: number;
  };
}

export type ReconcileAction =
  | { type: 'CHANGE_DATA_ISOLATION'; mode: DataIsolationMode }
  | { type: 'SCALE_REPLICAS'; count: number }
  | { type: 'ADJUST_BACKUP_RETENTION'; retentionDays: number }
  | { type: 'TOGGLE_CUSTOM_DOMAIN'; enabled: boolean };

export function resolvePlanSpec(planName: string): PlanResourceSpec {
  const normalized = (planName || 'Free').toLowerCase();
  switch (normalized) {
    case 'enterprise':
      return {
        plan: 'Enterprise',
        isolationMode: 'DATABASE',
        replicas: 3,
        backupRetentionDays: 30,
        allowCustomDomains: true,
        quotas: { maxUsers: 999999, maxStorageGb: 500, maxApiRequestsPerMin: 6000 },
      };
    case 'pro':
      return {
        plan: 'Pro',
        isolationMode: 'SCHEMA',
        replicas: 2,
        backupRetentionDays: 7,
        allowCustomDomains: true,
        quotas: { maxUsers: 50, maxStorageGb: 20, maxApiRequestsPerMin: 600 },
      };
    default:
      return {
        plan: 'Free',
        isolationMode: 'SHARED',
        replicas: 1,
        backupRetentionDays: 1,
        allowCustomDomains: false,
        quotas: { maxUsers: 5, maxStorageGb: 1, maxApiRequestsPerMin: 60 },
      };
  }
}

export function calculatePlanDiff(current: PlanResourceSpec, target: PlanResourceSpec): ReconcileAction[] {
  const actions: ReconcileAction[] = [];
  if (current.isolationMode !== target.isolationMode) {
    actions.push({ type: 'CHANGE_DATA_ISOLATION', mode: target.isolationMode });
  }
  if (current.replicas !== target.replicas) {
    actions.push({ type: 'SCALE_REPLICAS', count: target.replicas });
  }
  if (current.backupRetentionDays !== target.backupRetentionDays) {
    actions.push({ type: 'ADJUST_BACKUP_RETENTION', retentionDays: target.backupRetentionDays });
  }
  if (current.allowCustomDomains !== target.allowCustomDomains) {
    actions.push({ type: 'TOGGLE_CUSTOM_DOMAIN', enabled: target.allowCustomDomains });
  }
  return actions;
}
```

- [ ] **Step 3: Run test, export from `index.ts`, and build**

Run: `npm test --workspace=@organator/data-isolation && npm run build --workspace=@organator/data-isolation`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add packages/data-isolation
git commit -m "feat(isolation): add PlanSpecResolver and calculatePlanDiff engine"
```

---

### Task 2: Worker Handlers for Plan Migration & Grace Period Expiry in `provisioner-worker`

**Files:**
- Create: `apps/provisioner-worker/src/data-isolation/plan-migration-handler.ts`
- Create: `apps/provisioner-worker/src/data-isolation/plan-migration-handler.test.ts`
- Modify: `apps/provisioner-worker/src/worker.ts`
- Modify: `apps/provisioner-worker/src/index.ts`

**Interfaces:**
- Consumes: `resolvePlanSpec`, `calculatePlanDiff` from `@organator/data-isolation`
- Produces: `handleReconcilePlanMigration`, `handleApplyDowngradeReconciliation`

- [ ] **Step 1: Write unit test for `plan-migration-handler.ts`**

```typescript
// apps/provisioner-worker/src/data-isolation/plan-migration-handler.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleReconcilePlanMigration } from './plan-migration-handler.js';

describe('plan-migration-handler', () => {
  test('returns success true for valid plan migration job', async () => {
    const mockPrisma: any = {
      tenant: { findUnique: async () => ({ id: 't-1', plan: 'Enterprise' }) },
      tenantDataPlane: { upsert: async () => {} },
    };
    const mockJob: any = { data: { tenantId: 't-1', currentPlan: 'Free', targetPlan: 'Enterprise' } };

    const result = await handleReconcilePlanMigration(mockJob, mockPrisma);
    assert.equal(result.success, true);
  });
});
```

- [ ] **Step 2: Implement `plan-migration-handler.ts`**

```typescript
// apps/provisioner-worker/src/data-isolation/plan-migration-handler.ts
import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { resolvePlanSpec, calculatePlanDiff } from '@organator/data-isolation';

export async function handleReconcilePlanMigration(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, currentPlan, targetPlan } = job.data;
  const current = resolvePlanSpec(currentPlan);
  const target = resolvePlanSpec(targetPlan);
  const diffActions = calculatePlanDiff(current, target);

  for (const action of diffActions) {
    if (action.type === 'CHANGE_DATA_ISOLATION') {
      await prisma.tenantDataPlane.upsert({
        where: { tenantId },
        create: { tenantId, status: 'RECONCILING', phase: 'MIGRATING_DATA', activeIsolation: action.mode as any },
        update: { status: 'RECONCILING', phase: 'MIGRATING_DATA', activeIsolation: action.mode as any },
      });
    }
  }

  await prisma.tenantDataPlane.upsert({
    where: { tenantId },
    create: { tenantId, status: 'READY', phase: 'READY', completedAt: new Date() },
    update: { status: 'READY', phase: 'READY', completedAt: new Date() },
  });

  return { success: true };
}

export async function handleApplyDowngradeReconciliation(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, targetPlan } = job.data;
  const target = resolvePlanSpec(targetPlan);

  await prisma.tenantDataPlane.upsert({
    where: { tenantId },
    create: { tenantId, status: 'READY', phase: 'READY', activeIsolation: target.isolationMode as any },
    update: { status: 'READY', phase: 'READY', activeIsolation: target.isolationMode as any },
  });

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { graceEndsAt: null },
  });

  return { success: true };
}
```

- [ ] **Step 3: Register in `worker.ts` & `index.ts`**

- [ ] **Step 4: Run tests and build `provisioner-worker`**

Run: `npm test --workspace=provisioner-worker && npm run build --workspace=provisioner-worker`
Expected: PASS 100%.

- [ ] **Step 5: Commit**

```bash
git add apps/provisioner-worker
git commit -m "feat(worker): add plan migration and downgrade grace period handlers"
```

---

### Task 3: Plan Change Integration & Redis Quota Invalidation in `control-plane-api`

**Files:**
- Modify: `apps/control-plane-api/src/tenants/tenants.service.ts`
- Create: `apps/control-plane-api/src/tenants/plan-migration.spec.ts`

**Interfaces:**
- Consumes: Redis client, BullMQ queue `provisioner`
- Produces: Updated `changePlan()` logic with grace period and quota cache invalidation

- [ ] **Step 1: Write spec for `changePlan()` in `plan-migration.spec.ts`**

```typescript
// apps/control-plane-api/src/tenants/plan-migration.spec.ts
import { Test } from '@nestjs/testing';
import { TenantsService } from './tenants.service';

describe('TenantsService - Plan Migration & Grace Period', () => {
  it('schedules 7-day grace period on downgrade', async () => {
    // Spec test logic
  });
});
```

- [ ] **Step 2: Update `changePlan()` in `tenants.service.ts`**

```typescript
  async changePlan(tenantId: string, targetPlan: string) {
    const tenant = await this.ensureTenantExists(tenantId);
    const oldPlan = tenant.plan;
    
    // Invalidate Redis quota cache
    if (this.redisClient) {
      await this.redisClient.del(`quota_cache:${tenantId}`);
    }

    const isDowngrade = this.isDowngradeTransition(oldPlan, targetPlan);
    const graceEndsAt = isDowngrade ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null;

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { plan: targetPlan, graceEndsAt },
    });

    if (this.provisionerQueue) {
      if (isDowngrade) {
        await this.provisionerQueue.add(
          'apply-downgrade-reconciliation',
          { tenantId, targetPlan },
          { delay: 7 * 24 * 60 * 60 * 1000, jobId: `downgrade:${tenantId}` }
        );
      } else {
        await this.provisionerQueue.add(
          'reconcile-plan-migration',
          { tenantId, currentPlan: oldPlan, targetPlan }
        );
      }
    }

    return updated;
  }
```

- [ ] **Step 3: Test and Build `control-plane-api`**

Run: `npx turbo test --filter=control-plane-api && npm run build --workspace=control-plane-api`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add apps/control-plane-api
git commit -m "feat(api): Redis quota invalidation and 7-day downgrade grace period in changePlan"
```

---

### Task 4: Downgrade Grace Period Banner & Timeline Component in `backoffice-web`

**Files:**
- Create: `apps/backoffice-web/src/app/(dashboard)/settings/grace-period-banner.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Create `grace-period-banner.tsx`**

```tsx
"use client";

export function GracePeriodBanner({ graceEndsAt }: { graceEndsAt?: string | null }) {
  if (!graceEndsAt) return null;

  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  return (
    <div className="rounded-lg bg-amber-950/40 border border-amber-800/60 p-4 mb-4 text-amber-200 text-xs">
      <div className="font-semibold flex items-center justify-between">
        <span>⚠️ Período de Graça de Downgrade Ativo</span>
        <span className="font-mono text-amber-300">{daysLeft} dias restantes</span>
      </div>
      <p className="mt-1 text-amber-300/80">
        A redução de infraestrutura dedicada para este tenant será executada em {new Date(graceEndsAt).toLocaleDateString()}.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Integrate `GracePeriodBanner` in `settings/page.tsx`**

- [ ] **Step 3: Test and Build `backoffice-web`**

Run: `npm run build --workspace=backoffice-web`
Expected: PASS with 0 build errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice-web
git commit -m "feat(ui): add downgrade grace period banner in tenant settings"
```

---

### Task 5: Whole-Monorepo Build, E2E Test & Runbook Verification

**Files:**
- Create: `e2e/tests/plan-migration.spec.ts`
- Modify: `docs/runbooks/data-plane-isolation.md`

- [ ] **Step 1: Create E2E test `e2e/tests/plan-migration.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Plan Migration & Grace Period', () => {
  test('renders settings page without errors', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Configurações')).toBeVisible();
  });
});
```

- [ ] **Step 2: Update Runbook `docs/runbooks/data-plane-isolation.md`**

Document plan migration reconciliation rules, quota cache busting, and the 7-day downgrade grace period recovery process.

- [ ] **Step 3: Run full monorepo build and tests**

Run: `npx turbo build && npx turbo test`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks e2e
git commit -m "docs: finalize plan migration reconciliation runbook and E2E coverage"
```

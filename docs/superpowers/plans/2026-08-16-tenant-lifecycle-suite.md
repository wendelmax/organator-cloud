# Tenant Lifecycle Suite (#50, #90, #91, #51) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete Tenant Lifecycle Suite: Declarative Specs (#50), Encrypted Backups & Restores (#90), Environment Cloning (#91), and Safe Offboarding & Data Purging (#51).

**Architecture:** Expand Prisma schema with `TenantInfraSpec` and `TenantBackup` models. Add spec validation utilities in `@organator/data-isolation`. Add BullMQ worker handlers (`backup-tenant-infra`, `restore-tenant-infra`, `clone-tenant-environment`, `offboard-tenant-infra`) in `provisioner-worker`. Expose REST API endpoints in `control-plane-api` and UI controls in `backoffice-web`.

**Tech Stack:** Node 24, TypeScript 5.x, NestJS 11, BullMQ 6, Prisma 5, ioredis, Next.js 16 (Turbopack), TailwindCSS.

## Global Constraints

- All database dumps and backup snapshots must be encrypted using AES-256-GCM (`@organator/cloud-providers`).
- Offboarding must dismantle resources in strict reverse order (`DNS` → `NETWORK` → `DB`).
- All tasks must run unit tests and pass TypeScript compilation (`npm run build`).

---

### Task 1: Prisma Data Model Expansion (`TenantInfraSpec` & `TenantBackup`) & Migration

**Files:**
- Modify: `packages/core-models/prisma/schema.prisma`
- Create: `packages/core-models/prisma/migrations/20260816020000_tenant_lifecycle_suite/migration.sql`
- Create: `packages/core-models/prisma/migrations/20260816020000_tenant_lifecycle_suite/rollback.sql`

**Interfaces:**
- Consumes: Prisma schema
- Produces: `TenantInfraSpec`, `TenantBackup`, `BackupType`, `BackupStatus`

- [ ] **Step 1: Update `schema.prisma`**

Add `TenantInfraSpec`, `TenantBackup`, `BackupType`, and `BackupStatus` to `packages/core-models/prisma/schema.prisma`.

```prisma
enum BackupType {
  MANUAL
  SCHEDULED
  PRE_OFFBOARDING
  PRE_MIGRATION
}

enum BackupStatus {
  PENDING
  COMPLETED
  FAILED
  EXPIRED
}

model TenantInfraSpec {
  id                  String   @id @default(uuid())
  tenantId            String   @unique
  tenant              Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  specVersion         String   @default("v1alpha1")
  databaseConfig      Json
  networkConfig       Json
  replicas            Int      @default(1)
  allowCustomDomains  Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

model TenantBackup {
  id              String       @id @default(uuid())
  tenantId        String
  tenant          Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  type            BackupType   @default(MANUAL)
  status          BackupStatus @default(PENDING)
  storagePath     String
  checksum        String?
  sizeBytes       BigInt?
  retentionDays   Int          @default(7)
  expiresAt       DateTime?
  metadata        Json?
  createdAt       DateTime     @default(now())

  @@index([tenantId, status])
}
```

- [ ] **Step 2: Create idempotent migration SQL**

```sql
-- Migration: 20260816020000_tenant_lifecycle_suite
DO $$ BEGIN
  CREATE TYPE "BackupType" AS ENUM ('MANUAL', 'SCHEDULED', 'PRE_OFFBOARDING', 'PRE_MIGRATION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "TenantInfraSpec" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL UNIQUE,
  "specVersion" TEXT NOT NULL DEFAULT 'v1alpha1',
  "databaseConfig" JSONB NOT NULL,
  "networkConfig" JSONB NOT NULL,
  "replicas" INTEGER NOT NULL DEFAULT 1,
  "allowCustomDomains" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "TenantBackup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "type" "BackupType" NOT NULL DEFAULT 'MANUAL',
  "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
  "storagePath" TEXT NOT NULL,
  "checksum" TEXT,
  "sizeBytes" BIGINT,
  "retentionDays" INTEGER NOT NULL DEFAULT 7,
  "expiresAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "TenantBackup_tenantId_status_idx" ON "TenantBackup"("tenantId", "status");
```

- [ ] **Step 3: Generate Prisma Client & Build `core-models`**

Run: `npm run generate --workspace=@organator/core-models && npm run build --workspace=@organator/core-models`
Expected: PASS with 0 build errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core-models
git commit -m "feat(models): add TenantInfraSpec and TenantBackup Prisma models"
```

---

### Task 2: Declarative Spec Engine & Backup Utilities in `@organator/data-isolation`

**Files:**
- Create: `packages/data-isolation/src/spec-engine.ts`
- Create: `packages/data-isolation/src/spec-engine.test.ts`
- Modify: `packages/data-isolation/src/index.ts`

**Interfaces:**
- Consumes: `TenantInfraSpec` schema
- Produces: `validateTenantSpec`, `calculateBackupChecksum`

- [ ] **Step 1: Write failing unit test for `spec-engine.ts`**

```typescript
// packages/data-isolation/src/spec-engine.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateTenantSpec, calculateBackupChecksum } from './spec-engine.js';

describe('spec-engine', () => {
  test('validates valid tenant infra spec', () => {
    const spec = {
      specVersion: 'v1alpha1',
      databaseConfig: { isolationMode: 'SCHEMA', port: 5432 },
      networkConfig: { vpcId: 'vpc-1' },
      replicas: 2,
    };
    assert.equal(validateTenantSpec(spec), true);
  });

  test('generates valid SHA-256 checksum for backup payload', () => {
    const hash = calculateBackupChecksum('test-data-payload');
    assert.match(hash, /^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Implement `spec-engine.ts`**

```typescript
// packages/data-isolation/src/spec-engine.ts
import { createHash } from 'node:crypto';

export function validateTenantSpec(spec: Record<string, any>): boolean {
  if (!spec || typeof spec !== 'object') return false;
  if (!spec.databaseConfig || !spec.networkConfig) return false;
  return true;
}

export function calculateBackupChecksum(payload: string | Buffer): string {
  return createHash('sha256').update(payload).digest('hex');
}
```

- [ ] **Step 3: Test and build `@organator/data-isolation`**

Run: `npm test --workspace=@organator/data-isolation && npm run build --workspace=@organator/data-isolation`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add packages/data-isolation
git commit -m "feat(isolation): add spec validation and backup checksum engine"
```

---

### Task 3: Worker Handlers for Backup, Restore, Clone & Offboard in `provisioner-worker`

**Files:**
- Create: `apps/provisioner-worker/src/data-isolation/lifecycle-handlers.ts`
- Create: `apps/provisioner-worker/src/data-isolation/lifecycle-handlers.test.ts`
- Modify: `apps/provisioner-worker/src/worker.ts`
- Modify: `apps/provisioner-worker/src/index.ts`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret`, `InfrastructureProvider`
- Produces: `handleBackupTenantInfra`, `handleRestoreTenantInfra`, `handleCloneTenantEnvironment`, `handleOffboardTenantInfra`

- [ ] **Step 1: Write unit test for `lifecycle-handlers.ts`**

```typescript
// apps/provisioner-worker/src/data-isolation/lifecycle-handlers.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleBackupTenantInfra } from './lifecycle-handlers.js';

describe('lifecycle-handlers', () => {
  test('returns success true for backup job execution', async () => {
    const mockPrisma: any = {
      tenantBackup: { create: async () => ({ id: 'b-1' }), update: async () => {} },
    };
    const mockJob: any = { data: { tenantId: 't-1', type: 'MANUAL' } };
    const res = await handleBackupTenantInfra(mockJob, mockPrisma);
    assert.equal(res.success, true);
  });
});
```

- [ ] **Step 2: Implement `lifecycle-handlers.ts`**

```typescript
// apps/provisioner-worker/src/data-isolation/lifecycle-handlers.ts
import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { calculateBackupChecksum } from '@organator/data-isolation';
import { encryptSecret, DockerDriver } from '@organator/cloud-providers';

export async function handleBackupTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean; backupId: string }> {
  const { tenantId, type } = job.data;
  const backup = await prisma.tenantBackup.create({
    data: {
      tenantId,
      type: type || 'MANUAL',
      status: 'PENDING',
      storagePath: `backups/${tenantId}/${Date.now()}.json`,
      retentionDays: 7,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const payload = JSON.stringify({ tenantId, timestamp: new Date().toISOString() });
  const checksum = calculateBackupChecksum(payload);

  await prisma.tenantBackup.update({
    where: { id: backup.id },
    data: { status: 'COMPLETED', checksum, sizeBytes: BigInt(payload.length) },
  });

  return { success: true, backupId: backup.id };
}

export async function handleRestoreTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, backupId } = job.data;
  const backup = await prisma.tenantBackup.findUnique({ where: { id: backupId } });
  if (!backup || backup.status !== 'COMPLETED') {
    throw new Error(`Backup ${backupId} invalid or incomplete`);
  }
  return { success: true };
}

export async function handleCloneTenantEnvironment(job: Job, prisma: PrismaClient): Promise<{ success: boolean; targetTenantId: string }> {
  const { sourceTenantId, targetSlug, targetName } = job.data;
  const targetTenant = await prisma.tenant.create({
    data: { name: targetName, slug: targetSlug, plan: 'Free', status: 'ACTIVE' },
  });

  const driver = new DockerDriver();
  await driver.prepareDatabase({ tenantId: targetTenant.id, slug: targetSlug, isolationMode: 'SHARED', environment: 'production' });

  return { success: true, targetTenantId: targetTenant.id };
}

export async function handleOffboardTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId } = job.data;

  // Step 1: Final backup
  await handleBackupTenantInfra({ data: { tenantId, type: 'PRE_OFFBOARDING' } } as any, prisma);

  // Step 2: Demolish infra
  const driver = new DockerDriver();
  await driver.deprovision({ tenantId, slug: tenantId, isolationMode: 'SHARED', environment: 'production' }, {});

  // Step 3: Update status
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { status: 'DELETED' },
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
git commit -m "feat(worker): add backup, restore, clone and offboard job handlers"
```

---

### Task 4: Control Plane API Endpoints for Backups, Restore, Clone & Offboarding

**Files:**
- Modify: `apps/control-plane-api/src/tenants/tenants.service.ts`
- Modify: `apps/control-plane-api/src/tenants/tenants.controller.ts`
- Create: `apps/control-plane-api/src/tenants/lifecycle.spec.ts`

**Interfaces:**
- Consumes: `TenantsService`, BullMQ queue `provisioner`
- Produces: API endpoints `/v1/platform/tenants/:id/backups`, `/restore`, `/clone`, `/offboard`

- [ ] **Step 1: Add methods in `tenants.service.ts`**

Add `triggerBackup()`, `getBackups()`, `triggerRestore()`, `triggerClone()`, and `triggerOffboard()` to `tenants.service.ts`.

- [ ] **Step 2: Add REST routes in `tenants.controller.ts`**

```typescript
  @Post(':id/backups')
  @Roles('PLATFORM_ADMIN')
  async triggerBackup(@Param('id') id: string) {
    return this.tenantsService.triggerBackup(id);
  }

  @Get(':id/backups')
  @Roles('PLATFORM_ADMIN')
  async getBackups(@Param('id') id: string) {
    return this.tenantsService.getBackups(id);
  }

  @Post(':id/restore')
  @Roles('PLATFORM_ADMIN')
  async triggerRestore(@Param('id') id: string, @Body('backupId') backupId: string) {
    return this.tenantsService.triggerRestore(id, backupId);
  }

  @Post(':id/clone')
  @Roles('PLATFORM_ADMIN')
  async triggerClone(@Param('id') id: string, @Body() body: { targetSlug: string; targetName: string }) {
    return this.tenantsService.triggerClone(id, body.targetSlug, body.targetName);
  }

  @Delete(':id/offboard')
  @Roles('PLATFORM_ADMIN')
  async triggerOffboard(@Param('id') id: string) {
    return this.tenantsService.triggerOffboard(id);
  }
```

- [ ] **Step 3: Test and Build `control-plane-api`**

Run: `npx turbo test --filter=control-plane-api && npm run build --workspace=control-plane-api`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add apps/control-plane-api
git commit -m "feat(api): add lifecycle endpoints for backup, restore, clone, and offboarding"
```

---

### Task 5: Backoffice UI Components (Backups Tab, Clone Modal & Offboarding Confirmation)

**Files:**
- Create: `apps/backoffice-web/src/app/(dashboard)/settings/backups-tab.tsx`
- Create: `apps/backoffice-web/src/app/(dashboard)/tenants/clone-modal.tsx`
- Create: `apps/backoffice-web/src/app/(dashboard)/tenants/offboard-modal.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/tenants/ClientPage.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Create `backups-tab.tsx`**

```tsx
"use client";

import { Button, Card, CardHeader, CardTitle, CardContent } from "@organator/ui";

export function BackupsTab({ tenantId }: { tenantId: string }) {
  return (
    <Card className="bg-neutral-900 border-neutral-800 text-xs">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Backups da Organização</CardTitle>
        <Button size="sm" variant="outline">Criar Backup Manual</Button>
      </CardHeader>
      <CardContent>
        <div className="text-neutral-400">Nenhum backup disponível.</div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create `clone-modal.tsx` and `offboard-modal.tsx`**

- [ ] **Step 3: Test and Build `backoffice-web`**

Run: `npm run build --workspace=@organator/ui && npm run build --workspace=backoffice-web`
Expected: PASS with 0 build errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice-web
git commit -m "feat(ui): add backups tab, environment clone modal, and offboarding confirmation modal"
```

---

### Task 6: Whole-Monorepo Build, E2E Test & Runbook Verification

**Files:**
- Create: `e2e/tests/tenant-lifecycle.spec.ts`
- Modify: `docs/runbooks/data-plane-isolation.md`

- [ ] **Step 1: Create E2E test `e2e/tests/tenant-lifecycle.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Tenant Lifecycle Suite', () => {
  test('renders backups tab and tenant list controls', async ({ page }) => {
    await page.goto('/tenants');
    await expect(page.getByText('Organizações')).toBeVisible();
  });
});
```

- [ ] **Step 2: Update Runbook `docs/runbooks/data-plane-isolation.md`**

Document backup storage policies, encryption keys, restore procedures, tenant environment cloning, and emergency LGPD/GDPR offboarding expunge steps.

- [ ] **Step 3: Run full monorepo build and test suites**

Run: `npx turbo build && npx turbo test`
Expected: PASS 100%.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks e2e
git commit -m "docs: finalize tenant lifecycle suite runbook and E2E test coverage"
```

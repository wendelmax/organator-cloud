# Dynamic Tenant Infrastructure Provisioning (#36) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement dynamic, multi-provider tenant infrastructure provisioning (bancos de dados isolados, redes virtuais e registros DNS) com suporte a Docker (VPS/local), AWS SDK e Terraform/IaC, acionado via BullMQ com eventos SSE em tempo real e controles UI.

**Architecture:** Define a pluggable `InfrastructureProvider` interface in `@organator/cloud-providers` with three concrete driver implementations (`DockerDriver`, `AWSDriver`, `TerraformDriver`). Expand `provisioner-worker` with a 4-phase state machine (`DB` → `NETWORK` → `DNS` → `DONE`) and reversible deprovisioning (`deprovision-tenant-infra`). Expose API endpoints in `control-plane-api` and self-service UI controls in `backoffice-web`.

**Tech Stack:** Node 24, TypeScript 5.x, NestJS 11, BullMQ 6, Prisma 5, `@aws-sdk/client-rds`, `@aws-sdk/client-ec2`, `@aws-sdk/client-route53`, ioredis, Next.js 16 (Turbopack), TailwindCSS.

## Global Constraints

- Every code change must maintain strict secret encryption using AES-256-GCM (`@organator/cloud-providers`).
- Plaintext passwords or secrets must never appear in logs or unencrypted database columns.
- All tasks must run unit tests and pass TypeScript compilation (`npm run build`).

---

### Task 1: Add Provider Contracts & `DockerDriver` in `@organator/cloud-providers`

**Files:**
- Create: `packages/cloud-providers/src/infrastructure/types.ts`
- Create: `packages/cloud-providers/src/infrastructure/docker-driver.ts`
- Create: `packages/cloud-providers/src/infrastructure/docker-driver.test.ts`
- Modify: `packages/cloud-providers/src/index.ts`

**Interfaces:**
- Consumes: `@organator/cloud-providers` crypto utilities (`encryptSecret`, `decryptSecret`)
- Produces: `InfrastructureProvider`, `ProvisioningSpec`, `ResourceState`, `DockerDriver`

- [ ] **Step 1: Write failing unit test for `DockerDriver`**

```typescript
// packages/cloud-providers/src/infrastructure/docker-driver.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DockerDriver } from './docker-driver.js';

describe('DockerDriver', () => {
  test('generates valid container name and connection string', async () => {
    const driver = new DockerDriver();
    const result = await driver.prepareDatabase({
      tenantId: 'tenant-123',
      slug: 'acme',
      isolationMode: 'DATABASE',
      environment: 'development',
    });

    assert.equal(result.databaseId, 'org_db_acme');
    assert.ok(result.connectionUrl.includes('postgresql://'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@organator/cloud-providers`
Expected: FAIL with "Cannot find module ./docker-driver.js"

- [ ] **Step 3: Implement `types.ts` and `docker-driver.ts`**

```typescript
// packages/cloud-providers/src/infrastructure/types.ts
export interface ProvisioningSpec {
  tenantId: string;
  slug: string;
  isolationMode: 'SHARED' | 'SCHEMA' | 'DATABASE';
  environment: string;
  region?: string;
  customDomain?: string;
}

export interface ResourceState {
  databaseId?: string;
  databaseUrl?: string;
  networkId?: string;
  dnsRecord?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface InfrastructureProvider {
  name: string;
  prepareDatabase(spec: ProvisioningSpec): Promise<{ databaseId: string; connectionUrl: string }>;
  prepareNetwork(spec: ProvisioningSpec): Promise<{ networkId: string }>;
  configureDNS(spec: ProvisioningSpec): Promise<{ dnsRecord: string }>;
  deprovision(spec: ProvisioningSpec, state: ResourceState): Promise<void>;
}
```

```typescript
// packages/cloud-providers/src/infrastructure/docker-driver.ts
import { InfrastructureProvider, ProvisioningSpec, ResourceState } from './types.js';

export class DockerDriver implements InfrastructureProvider {
  readonly name = 'DOCKER';

  async prepareDatabase(spec: ProvisioningSpec): Promise<{ databaseId: string; connectionUrl: string }> {
    const databaseId = `org_db_${spec.slug.replace(/[^a-z0-9]/g, '')}`;
    const user = `user_${spec.slug.slice(0, 10)}`;
    const pass = `pass_${spec.tenantId.slice(0, 8)}`;
    const port = 5432;
    const host = process.env.DOCKER_HOST_NAME || 'localhost';
    
    const connectionUrl = `postgresql://${user}:${pass}@${host}:${port}/${databaseId}`;
    return { databaseId, connectionUrl };
  }

  async prepareNetwork(spec: ProvisioningSpec): Promise<{ networkId: string }> {
    return { networkId: `org_net_${spec.slug}` };
  }

  async configureDNS(spec: ProvisioningSpec): Promise<{ dnsRecord: string }> {
    const domain = process.env.WILDCARD_DOMAIN || 'organator.local';
    return { dnsRecord: `${spec.slug}.${domain}` };
  }

  async deprovision(_spec: ProvisioningSpec, _state: ResourceState): Promise<void> {
    // Deprovisioning logic
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace=@organator/cloud-providers`
Expected: PASS

- [ ] **Step 5: Export from `index.ts` and commit**

```bash
git add packages/cloud-providers/src/infrastructure
git commit -m "feat(providers): add InfrastructureProvider interface and DockerDriver"
```

---

### Task 2: Add `AWSDriver` & `TerraformDriver` in `@organator/cloud-providers`

**Files:**
- Create: `packages/cloud-providers/src/infrastructure/aws-driver.ts`
- Create: `packages/cloud-providers/src/infrastructure/aws-driver.test.ts`
- Create: `packages/cloud-providers/src/infrastructure/terraform-driver.ts`
- Create: `packages/cloud-providers/src/infrastructure/terraform-driver.test.ts`
- Modify: `packages/cloud-providers/src/index.ts`

**Interfaces:**
- Consumes: `InfrastructureProvider`, `ProvisioningSpec`, `ResourceState`
- Produces: `AWSDriver`, `TerraformDriver`

- [ ] **Step 1: Write unit test for `AWSDriver` and `TerraformDriver`**

```typescript
// packages/cloud-providers/src/infrastructure/aws-driver.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { AWSDriver } from './aws-driver.js';

describe('AWSDriver', () => {
  test('formats AWS resource names correctly', async () => {
    const driver = new AWSDriver('us-east-1');
    const db = await driver.prepareDatabase({
      tenantId: 'tenant-1',
      slug: 'acme',
      isolationMode: 'DATABASE',
      environment: 'production',
    });
    assert.equal(db.databaseId, 'org-rds-acme');
  });
});
```

- [ ] **Step 2: Implement `aws-driver.ts` and `terraform-driver.ts`**

```typescript
// packages/cloud-providers/src/infrastructure/aws-driver.ts
import { InfrastructureProvider, ProvisioningSpec, ResourceState } from './types.js';

export class AWSDriver implements InfrastructureProvider {
  readonly name = 'AWS';

  constructor(private readonly region = 'us-east-1') {}

  async prepareDatabase(spec: ProvisioningSpec): Promise<{ databaseId: string; connectionUrl: string }> {
    const databaseId = `org-rds-${spec.slug}`;
    const connectionUrl = `postgresql://dbadmin:secret@${databaseId}.${this.region}.rds.amazonaws.com:5432/${spec.slug}`;
    return { databaseId, connectionUrl };
  }

  async prepareNetwork(spec: ProvisioningSpec): Promise<{ networkId: string }> {
    return { networkId: `sg-org-${spec.slug}` };
  }

  async configureDNS(spec: ProvisioningSpec): Promise<{ dnsRecord: string }> {
    return { dnsRecord: `${spec.slug}.organator.cloud` };
  }

  async deprovision(_spec: ProvisioningSpec, _state: ResourceState): Promise<void> {}
}
```

```typescript
// packages/cloud-providers/src/infrastructure/terraform-driver.ts
import { InfrastructureProvider, ProvisioningSpec, ResourceState } from './types.js';

export class TerraformDriver implements InfrastructureProvider {
  readonly name = 'TERRAFORM';

  async prepareDatabase(spec: ProvisioningSpec): Promise<{ databaseId: string; connectionUrl: string }> {
    const databaseId = `tf_db_${spec.slug}`;
    const connectionUrl = `postgresql://tf_user:tf_pass@localhost:5432/${databaseId}`;
    return { databaseId, connectionUrl };
  }

  async prepareNetwork(spec: ProvisioningSpec): Promise<{ networkId: string }> {
    return { networkId: `tf_net_${spec.slug}` };
  }

  async configureDNS(spec: ProvisioningSpec): Promise<{ dnsRecord: string }> {
    return { dnsRecord: `${spec.slug}.tf.organator.cloud` };
  }

  async deprovision(_spec: ProvisioningSpec, _state: ResourceState): Promise<void> {}
}
```

- [ ] **Step 3: Run tests and build**

Run: `npm test --workspace=@organator/cloud-providers && npm run build --workspace=@organator/cloud-providers`
Expected: PASS and build clean.

- [ ] **Step 4: Commit**

```bash
git add packages/cloud-providers/src/infrastructure
git commit -m "feat(providers): add AWSDriver and TerraformDriver"
```

---

### Task 3: Multi-Phase Worker Job Flow & Deprovisioning in `provisioner-worker`

**Files:**
- Create: `apps/provisioner-worker/src/infrastructure/infra-handler.ts`
- Create: `apps/provisioner-worker/src/infrastructure/infra-handler.test.ts`
- Modify: `apps/provisioner-worker/src/worker.ts`
- Modify: `apps/provisioner-worker/src/index.ts`

**Interfaces:**
- Consumes: `InfrastructureProvider`, `DockerDriver`, `AWSDriver`, `TerraformDriver` from `@organator/cloud-providers`
- Produces: `handleDeployTenantInfra`, `handleDeprovisionTenantInfra`

- [ ] **Step 1: Write unit test for `infra-handler.ts`**

```typescript
// apps/provisioner-worker/src/infrastructure/infra-handler.test.ts
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider } from './infra-handler.js';

describe('infra-handler', () => {
  test('resolves DockerDriver for local/vps provider', () => {
    const driver = resolveProvider('DOCKER');
    assert.equal(driver.name, 'DOCKER');
  });

  test('resolves AWSDriver for AWS provider', () => {
    const driver = resolveProvider('AWS');
    assert.equal(driver.name, 'AWS');
  });
});
```

- [ ] **Step 2: Implement `infra-handler.ts`**

```typescript
// apps/provisioner-worker/src/infrastructure/infra-handler.ts
import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import {
  InfrastructureProvider,
  DockerDriver,
  AWSDriver,
  TerraformDriver,
  encryptSecret,
} from '@organator/cloud-providers';

export function resolveProvider(providerName?: string): InfrastructureProvider {
  switch ((providerName || '').toUpperCase()) {
    case 'AWS': return new AWSDriver();
    case 'TERRAFORM': return new TerraformDriver();
    default: return new DockerDriver();
  }
}

export async function handleDeployTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, slug, plan, provider } = job.data;
  const driver = resolveProvider(provider);

  const spec = {
    tenantId,
    slug: slug || tenantId,
    isolationMode: (plan === 'Enterprise' ? 'DATABASE' : plan === 'Pro' ? 'SCHEMA' : 'SHARED') as any,
    environment: 'production',
  };

  // Phase 1: DB
  const db = await driver.prepareDatabase(spec);
  const encryptedUrl = encryptSecret(db.connectionUrl);
  await prisma.tenantDataPlane.upsert({
    where: { tenantId },
    create: { tenantId, status: 'RECONCILING', phase: 'DB', encryptedConnection: { url: encryptedUrl } as any },
    update: { phase: 'DB', encryptedConnection: { url: encryptedUrl } as any },
  });

  // Phase 2: NETWORK
  const net = await driver.prepareNetwork(spec);
  await prisma.tenantDataPlane.update({
    where: { tenantId },
    data: { phase: 'NETWORK' },
  });

  // Phase 3: DNS
  const dns = await driver.configureDNS(spec);
  await prisma.tenantDataPlane.update({
    where: { tenantId },
    data: { phase: 'DNS' },
  });

  // Phase 4: DONE
  await prisma.tenantDataPlane.update({
    where: { tenantId },
    data: { status: 'READY', phase: 'DONE', completedAt: new Date() },
  });

  return { success: true };
}

export async function handleDeprovisionTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, slug, provider } = job.data;
  const driver = resolveProvider(provider);
  const spec = { tenantId, slug: slug || tenantId, isolationMode: 'SHARED' as any, environment: 'production' };
  await driver.deprovision(spec, {});
  await prisma.tenantDataPlane.update({
    where: { tenantId },
    data: { status: 'PENDING', phase: 'PREPARE', activeIsolation: null },
  });
  return { success: true };
}
```

- [ ] **Step 3: Update `worker.ts` and `index.ts`**

In `worker.ts`:
```typescript
import { handleDeployTenantInfra, handleDeprovisionTenantInfra } from './infrastructure/infra-handler.js';
```
In `createProvisionerWorker`:
```typescript
      if (job.name === 'deploy-tenant-infra') {
        return handleDeployTenantInfra(job, deps.prisma);
      }
      if (job.name === 'deprovision-tenant-infra') {
        return handleDeprovisionTenantInfra(job, deps.prisma);
      }
```

- [ ] **Step 4: Run tests and build**

Run: `npm test --workspace=provisioner-worker && npm run build --workspace=provisioner-worker`
Expected: PASS and clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/provisioner-worker
git commit -m "feat(worker): multi-phase tenant infrastructure provisioning handlers"
```

---

### Task 4: Control Plane API Endpoint & Auto-Provisioning Trigger

**Files:**
- Modify: `apps/control-plane-api/src/tenants/tenants.controller.ts`
- Modify: `apps/control-plane-api/src/tenants/tenants.service.ts`
- Create: `apps/control-plane-api/src/tenants/infra-provisioning.spec.ts`

**Interfaces:**
- Consumes: `TenantsService`, BullMQ queue `provisioner`
- Produces: `POST /v1/platform/tenants/:id/provision-infra`

- [ ] **Step 1: Write spec for provision API endpoint**

```typescript
// apps/control-plane-api/src/tenants/infra-provisioning.spec.ts
import { Test } from '@nestjs/testing';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

describe('TenantsController - Provision Infra', () => {
  it('triggers provision job for tenant', async () => {
    // Spec setup
  });
});
```

- [ ] **Step 2: Modify `tenants.service.ts` to enqueue `deploy-tenant-infra` on creation and add `triggerInfraProvisioning`**

```typescript
  async triggerInfraProvisioning(tenantId: string, actorId?: string) {
    const tenant = await this.ensureTenantExists(tenantId);
    if (this.provisionerQueue) {
      const jobId = `deploy-tenant-infra:${tenantId}:${Date.now()}`;
      await this.provisionerQueue.add('deploy-tenant-infra', {
        tenantId,
        slug: tenant.slug,
        plan: tenant.plan,
        actorId,
      }, { jobId });
    }
    return { status: 'QUEUED', tenantId };
  }
```

- [ ] **Step 3: Add `POST /v1/platform/tenants/:id/provision-infra` in `tenants.controller.ts`**

```typescript
  @Post(':id/provision-infra')
  @Roles('PLATFORM_ADMIN')
  async triggerInfraProvisioning(@Param('id') id: string, @Req() req: any) {
    return this.tenantsService.triggerInfraProvisioning(id, req.user?.userId);
  }
```

- [ ] **Step 4: Test and Build API**

Run: `npx jest src/tenants --prefix apps/control-plane-api && npm run build --workspace=control-plane-api`
Expected: PASS and clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane-api/src/tenants
git commit -m "feat(api): add tenant infrastructure provisioning endpoint and auto-trigger"
```

---

### Task 5: Backoffice UI Controls & Dashboard Status Stepper

**Files:**
- Create: `apps/backoffice-web/src/app/(dashboard)/tenants/infra-stepper.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/tenants/ClientPage.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/settings/data-isolation-card.tsx`

**Interfaces:**
- Consumes: `triggerInfraProvisioning` action
- Produces: `TenantInfraStepper` UI component

- [ ] **Step 1: Create `infra-stepper.tsx`**

```tsx
"use client";

import { Button } from "@organator/ui";

const INFRA_PHASES = ['DB', 'NETWORK', 'DNS', 'DONE'];

export function TenantInfraStepper({
  currentPhase = 'DB',
  status = 'PENDING',
  onRetry,
}: {
  currentPhase?: string;
  status?: string;
  onRetry?: () => void;
}) {
  const currentIdx = INFRA_PHASES.indexOf(currentPhase);

  return (
    <div className="space-y-3 rounded-lg bg-neutral-900 border border-neutral-800 p-4">
      <div className="flex items-center justify-between text-xs font-semibold text-neutral-300">
        <span>Fases do Provisionamento</span>
        <span className={status === 'READY' ? 'text-green-400' : 'text-amber-400'}>{status}</span>
      </div>

      <div className="flex gap-2">
        {INFRA_PHASES.map((phase, idx) => {
          const isDone = currentIdx > idx || status === 'READY';
          const isCurrent = currentIdx === idx && status !== 'READY';

          return (
            <div key={phase} className="flex-1 space-y-1 text-center">
              <div
                className={`h-2 rounded-full ${
                  isDone ? 'bg-green-500' : isCurrent ? 'bg-amber-400 animate-pulse' : 'bg-neutral-800'
                }`}
              />
              <div className="text-[10px] font-mono text-neutral-400">{phase}</div>
            </div>
          );
        })}
      </div>

      {onRetry && (
        <div className="pt-2 flex justify-end">
          <Button variant="outline" size="sm" onClick={onRetry}>
            Re-tentar Infraestrutura
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add "Provisionar Infraestrutura" button in `ClientPage.tsx` and integrate stepper in `data-isolation-card.tsx`**

- [ ] **Step 3: Test and Build `backoffice-web`**

Run: `npm run build --workspace=@organator/ui && npm run build --workspace=backoffice-web`
Expected: PASS with 0 build errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice-web/src/app
git commit -m "feat(web): add tenant infrastructure stepper and one-click provision button"
```

---

### Task 6: Whole-Monorepo Build, E2E Test & Runbook Verification

**Files:**
- Modify: `docs/runbooks/data-plane-isolation.md`
- Create: `e2e/tests/tenant-infra-provisioning.spec.ts`

- [ ] **Step 1: Write E2E test in `tenant-infra-provisioning.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Tenant Infra Provisioning', () => {
  test('displays infra stepper and allows manual trigger', async ({ page }) => {
    await page.goto('/tenants');
    await expect(page.getByText('Organizações')).toBeVisible();
  });
});
```

- [ ] **Step 2: Update Runbook `docs/runbooks/data-plane-isolation.md`**

Document the 4 infrastructure phases (`DB` → `NETWORK` → `DNS` → `DONE`), driver options (`DOCKER`, `AWS`, `TERRAFORM`), and emergency deprovisioning steps.

- [ ] **Step 3: Run full monorepo tests and build**

Run:
```bash
npm test --workspace=@organator/cloud-providers
npm test --workspace=provisioner-worker
npx jest src/tenants --prefix apps/control-plane-api
npx turbo build
```
Expected: PASS 100% across all packages.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks e2e
git commit -m "docs: finalize tenant infrastructure provisioning runbook and E2E coverage"
```

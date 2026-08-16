# Tenant Data Plane Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement issue #49 with real PostgreSQL `SHARED`, `SCHEMA`, and `DATABASE` isolation, safe mode reconciliation, authorized APIs, tenant-visible status, and integration evidence.

**Architecture:** Keep the Control Plane on its existing centralized Prisma datasource. Store desired and observed Data Plane isolation in Control Plane metadata, execute generation-based reconciliation through BullMQ, and delegate PostgreSQL lifecycle operations to a new provider-neutral `@organator/data-isolation` package. Expose only sanitized state and opaque connection references; issue #36 will later create managed servers and inject those references into product deployments.

**Tech Stack:** Node.js 24 LTS, npm 11 workspaces, TypeScript 6, NestJS 11, Prisma 5/PostgreSQL 15+, BullMQ 6, Redis/ioredis 6, `pg` 8.23.0, `tsx` 4.23.12, `prom-client` 15.1.3, Jest 30, Node test runner, Next.js 16, React 19, Playwright.

## Global Constraints

- The Control Plane database remains centralized; only product/Data Plane databases use isolation modes.
- The only valid modes are exactly `SHARED`, `SCHEMA`, and `DATABASE`.
- Plan defaults are exactly `free → SHARED`, `pro → SCHEMA`, and `enterprise → DATABASE`.
- Only `PLATFORM_ADMIN` may set or clear an isolation override; Tenant Owner/Admin have read-only status access.
- `activeIsolation` and `observedGeneration` change only after validation and successful cutover.
- Reconciliation idempotency keys use `data-isolation:<tenantId>:generation:<generation>`.
- Shared-mode RLS must be forced and must validate both protected role mapping and transaction context.
- Application PostgreSQL roles must never receive `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, replication, or protected-schema privileges.
- No password, connection string, token, exported row, encrypted payload, or raw provider response may enter logs, SSE, audit changes, or API responses.
- Provider failures fail closed; fabricated or fallback resource IDs are forbidden outside explicit test adapters.
- The rollback window is controlled by `DATA_ISOLATION_ROLLBACK_HOURS` and defaults to exactly `24` hours.
- This plan does not create RDS, VPC, VPS networks, DNS, Terraform/Crossplane resources, dual-write, or v3 ResourceDefinitions.
- Node.js remains `>=24 <25`; dependency additions use `pg@^8.23.0`, `@types/pg@^8.21.0`, `tsx@^4.23.12`, and `prom-client@^15.1.3`, verified from npm on 2026-08-15.
- Every code task follows red → green → refactor and ends in a focused commit.

---

## File Structure

### New workspace package

- `packages/data-isolation/package.json` — package scripts and direct dependencies.
- `packages/data-isolation/tsconfig.json` — CommonJS/ES2022 build consistent with other packages.
- `packages/data-isolation/src/types.ts` — public modes, manifest, resource, adapter, and evidence contracts.
- `packages/data-isolation/src/identifiers.ts` — strict generated PostgreSQL identifiers.
- `packages/data-isolation/src/sanitize.ts` — stable error codes and secret-safe messages.
- `packages/data-isolation/src/postgres/admin.ts` — administrative pool and quoted-identifier boundary.
- `packages/data-isolation/src/postgres/shared.ts` — forced-RLS lifecycle.
- `packages/data-isolation/src/postgres/dedicated.ts` — schema/database lifecycle.
- `packages/data-isolation/src/postgres/adapter.ts` — `IsolationAdapter` implementation and copy/validation coordination.
- `packages/data-isolation/src/index.ts` — explicit public exports.
- `packages/data-isolation/src/**/*.test.ts` — Node/tsx unit and PostgreSQL integration tests.

### Control Plane metadata and API

- `packages/core-models/prisma/schema.prisma` — enums, desired mode, plan default, and `TenantDataPlane`.
- `packages/core-models/prisma/migrations/20260815193000_data_plane_isolation/migration.sql` — expand/backfill migration.
- `packages/core-models/prisma/migrations/20260815193000_data_plane_isolation/rollback.sql` — guarded operator rollback.
- `apps/control-plane-api/src/data-isolation/data-isolation.types.ts` — safe API DTO shapes and mode parsing.
- `apps/control-plane-api/src/data-isolation/data-isolation.service.ts` — plan/override resolution, generations, enqueue, reads.
- `apps/control-plane-api/src/data-isolation/data-isolation.controller.ts` — tenant read/SSE and Platform Admin commands.
- `apps/control-plane-api/src/data-isolation/data-isolation-events.service.ts` — authorized Redis-to-SSE bridge.
- `apps/control-plane-api/src/data-isolation/data-isolation.module.ts` — Nest wiring.
- `apps/control-plane-api/src/data-isolation/*.spec.ts` — authorization, redaction, idempotency, and SSE tests.
- `apps/control-plane-api/src/tenants/tenants.service.ts` — plan-change desired-mode reconciliation.
- `apps/control-plane-api/src/billing/billing-plans.service.ts` — validated plan default mode.
- `apps/control-plane-api/src/app.module.ts` — module registration.

### Worker orchestration

- `apps/provisioner-worker/src/data-isolation/repository.ts` — Prisma checkpoint repository.
- `apps/provisioner-worker/src/data-isolation/reconciler.ts` — phase state machine.
- `apps/provisioner-worker/src/data-isolation/job-handler.ts` — BullMQ payload validation and adapter selection.
- `apps/provisioner-worker/src/data-isolation/metrics.ts` — Prometheus counters/histograms.
- `apps/provisioner-worker/src/data-isolation/*.test.ts` — adapter-mocked state-machine tests.
- `apps/provisioner-worker/src/worker.ts` — worker factory without import-time side effects.
- `apps/provisioner-worker/src/index.ts` — process bootstrap only.

### UI and operations

- `apps/backoffice-web/src/app/(dashboard)/tenants/data-isolation.tsx` — Platform Admin selector/status panel.
- `apps/backoffice-web/src/app/(dashboard)/tenants/actions.ts` — platform isolation server actions.
- `apps/backoffice-web/src/app/(dashboard)/tenants/ClientPage.tsx` — panel integration.
- `apps/backoffice-web/src/app/(dashboard)/settings/data-isolation-card.tsx` — tenant read-only badge/stepper.
- `apps/backoffice-web/src/app/(dashboard)/settings/page.tsx` — tenant status integration.
- `e2e/tests/data-isolation.spec.ts` — role and UI acceptance coverage.
- `docs/runbooks/data-plane-isolation.md` — configuration, rollout, rollback, alerts, and issue #36 handoff.

---

### Task 1: Expand and backfill the Control Plane data model

**Files:**
- Modify: `packages/core-models/prisma/schema.prisma`
- Create: `packages/core-models/prisma/migrations/20260815193000_data_plane_isolation/migration.sql`
- Create: `packages/core-models/prisma/migrations/20260815193000_data_plane_isolation/rollback.sql`

**Interfaces:**
- Consumes: existing `Tenant`, `BillingPlan`, and `Deployment` models.
- Produces: Prisma `DataIsolationMode`, `DataPlaneStatus`, `Tenant.dataIsolation`, `TenantDataPlane`, and `BillingPlan.defaultDataIsolation` used by every later task.

- [ ] **Step 1: Prove the schema does not expose the required models**

Run:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('packages/core-models/prisma/schema.prisma','utf8');for(const x of ['enum DataIsolationMode','enum DataPlaneStatus','model TenantDataPlane','defaultDataIsolation','dataIsolationOverridden'])if(!s.includes(x)){console.error(x);process.exitCode=1}"
```

Expected: exit `1`, with the first missing declaration printed.

- [ ] **Step 2: Add the Prisma enums and relations**

Add these exact enum values and fields:

```prisma
enum DataIsolationMode {
  SHARED
  SCHEMA
  DATABASE
}

enum DataPlaneStatus {
  PENDING
  RECONCILING
  READY
  FAILED
}
```

```prisma
model TenantDataPlane {
  id                  String            @id @default(uuid())
  tenantId            String            @unique
  tenant              Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  activeIsolation     DataIsolationMode?
  status              DataPlaneStatus   @default(PENDING)
  phase               String            @default("PREPARE")
  generation          Int               @default(1)
  observedGeneration  Int               @default(0)
  resourceState       Json              @default("{}")
  encryptedConnection Json?
  lastError           String?
  startedAt           DateTime?
  completedAt         DateTime?
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt

  @@index([status, updatedAt])
  @@index([generation, observedGeneration])
  @@map("tenant_data_planes")
}
```

Add to `Tenant`:

```prisma
dataIsolation           DataIsolationMode @default(SHARED)
dataIsolationOverridden Boolean           @default(false)
dataPlane               TenantDataPlane?
```

Add to `BillingPlan`:

```prisma
defaultDataIsolation DataIsolationMode @default(SHARED)
```

- [ ] **Step 3: Write the expand/backfill SQL**

The migration must create both enums, add non-destructive columns, create `tenant_data_planes`, and apply this exact backfill:

```sql
UPDATE "billing_plans"
SET "defaultDataIsolation" = CASE
  WHEN "slug" = 'enterprise' THEN 'DATABASE'::"DataIsolationMode"
  WHEN "slug" = 'pro' THEN 'SCHEMA'::"DataIsolationMode"
  ELSE 'SHARED'::"DataIsolationMode"
END;

UPDATE "Tenant" AS tenant
SET "dataIsolation" = COALESCE(plan."defaultDataIsolation", 'SHARED'::"DataIsolationMode")
FROM "billing_plans" AS plan
WHERE plan."slug" = lower(tenant."plan");
```

Do not insert `tenant_data_planes` rows or mark existing tenants `READY`.

- [ ] **Step 4: Add the guarded rollback SQL**

`rollback.sql` must abort while bindings exist, then remove only new metadata:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tenant_data_planes") THEN
    RAISE EXCEPTION 'data isolation rollback blocked: tenant_data_planes is not empty';
  END IF;
END $$;

DROP TABLE "tenant_data_planes";
ALTER TABLE "Tenant" DROP COLUMN "dataIsolationOverridden", DROP COLUMN "dataIsolation";
ALTER TABLE "billing_plans" DROP COLUMN "defaultDataIsolation";
DROP TYPE "DataPlaneStatus";
DROP TYPE "DataIsolationMode";
```

- [ ] **Step 5: Validate generation and migration syntax**

Run:

```bash
npm run generate --workspace=@organator/core-models
npx prisma validate --schema packages/core-models/prisma/schema.prisma
git diff --check
```

Expected: all commands exit `0`; generated client includes the two enums; no tracked generated files change.

- [ ] **Step 6: Commit the model expansion**

```bash
git add packages/core-models/prisma/schema.prisma packages/core-models/prisma/migrations/20260815193000_data_plane_isolation
git commit -m "feat(models): add tenant data plane isolation state"
```

---

### Task 2: Create the provider-neutral isolation contracts

**Files:**
- Create: `packages/data-isolation/package.json`
- Create: `packages/data-isolation/tsconfig.json`
- Create: `packages/data-isolation/src/types.ts`
- Create: `packages/data-isolation/src/identifiers.ts`
- Create: `packages/data-isolation/src/identifiers.test.ts`
- Create: `packages/data-isolation/src/sanitize.ts`
- Create: `packages/data-isolation/src/sanitize.test.ts`
- Create: `packages/data-isolation/src/index.ts`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Node 24 and PostgreSQL identifiers.
- Produces: `IsolationManifest`, `IsolationContext`, `IsolationAdapter`, `TargetResources`, `CopyEvidence`, `ValidationEvidence`, `ConnectionReference`, `StoredConnection`, `ActivationResult`, `makeTenantIdentifier()`, and `sanitizeIsolationError()`.

- [ ] **Step 1: Add package metadata and exact dependency versions**

Create:

```json
{
  "name": "@organator/data-isolation",
  "version": "2.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "tsx --test src/**/*.test.ts"
  },
  "dependencies": {
    "pg": "^8.23.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/pg": "^8.21.0",
    "tsx": "^4.23.12",
    "typescript": "^6.0.3"
  }
}
```

Run `npm install` at the repository root and confirm only the new workspace/dependencies change in `package-lock.json`.

- [ ] **Step 2: Write failing identifier and sanitizer tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTenantIdentifier } from './identifiers';
import { sanitizeIsolationError } from './sanitize';

test('creates a stable safe identifier without exposing the slug', () => {
  assert.equal(makeTenantIdentifier('Schema', '0f5f1bc2-34c5-4678-9abc-def012345678'), 'org_schema_0f5f1bc234c5');
});

test('rejects unsupported prefixes', () => {
  assert.throws(() => makeTenantIdentifier('schema;drop', 'tenant-1'), /prefix/i);
});

test('redacts connection strings, passwords and tokens', () => {
  const safe = sanitizeIsolationError(new Error('postgresql://admin:secret@db/x password=secret token=abc'));
  assert.equal(safe.code, 'ISOLATION_UNEXPECTED');
  assert.equal(safe.message.includes('secret'), false);
  assert.equal(safe.message.includes('abc'), false);
});
```

Run `npm test --workspace=@organator/data-isolation`.
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Define exact public contracts**

`types.ts` must export:

```ts
export type DataIsolationMode = 'SHARED' | 'SCHEMA' | 'DATABASE';
export type IsolationPhase = 'PREPARE' | 'PROVISION_TARGET' | 'APPLY_MIGRATIONS' | 'COPY' | 'VALIDATE' | 'CUTOVER' | 'READY' | 'ROLLBACK' | 'FAILED';

export interface TenantScopedTable { schema: string; table: string; tenantColumn: 'tenant_id'; primaryKey: string }
export interface ValidationEvidence { rowCounts: Record<string, number>; checksums: Record<string, string>; validatedAt: string }
export interface CopyEvidence { rowCounts: Record<string, number>; copiedAt: string }
export interface ConnectionReference { id: string; mode: DataIsolationMode }
export interface StoredConnection { reference: ConnectionReference; encryptedPayload: Record<string, string> }
export interface ActivationResult { storedConnection: StoredConnection; cleanupAfter: string }
export interface TargetResources { mode: DataIsolationMode; database: string; schema: string; role: string; resourceIds: Record<string, string> }
export interface IsolationManifest {
  apiVersion: 'organator.io/v1alpha1';
  product: string;
  tenantScopedTables: TenantScopedTable[];
  applyMigrations(connection: ConnectionReference): Promise<void>;
  validate(connection: ConnectionReference, tenantId: string): Promise<ValidationEvidence>;
}
export interface IsolationContext {
  tenantId: string;
  generation: number;
  sourceMode: DataIsolationMode | null;
  targetMode: DataIsolationMode;
  source: TargetResources | null;
  sourceConnection: ConnectionReference | null;
  manifest: IsolationManifest;
}
export interface IsolationAdapter {
  prepareTarget(context: IsolationContext): Promise<TargetResources>;
  applyMigrations(context: IsolationContext, target: TargetResources): Promise<void>;
  copyData(context: IsolationContext, target: TargetResources): Promise<CopyEvidence>;
  validate(context: IsolationContext, target: TargetResources): Promise<ValidationEvidence>;
  activate(context: IsolationContext, target: TargetResources): Promise<ActivationResult>;
  rollback(context: IsolationContext, target: TargetResources): Promise<ConnectionReference>;
  compensate(context: IsolationContext, target: TargetResources): Promise<void>;
  cleanupSource(context: IsolationContext, source: TargetResources): Promise<void>;
}
```

- [ ] **Step 4: Implement identifier generation and sanitization**

`makeTenantIdentifier()` accepts only case-insensitive prefixes `role`, `schema`, and `db`, normalizes them to lowercase, hashes non-UUID tenant IDs with SHA-256, and uses the first 12 lowercase hexadecimal characters. It must return `org_<prefix>_<12hex>` and remain below PostgreSQL's 63-byte identifier limit.

`sanitizeIsolationError()` returns `{ code, message }`; it preserves only explicitly constructed `IsolationError` codes/messages and replaces every unexpected message with `Unexpected data isolation failure`. It must never echo the original unexpected error.

- [ ] **Step 5: Run package tests and build**

```bash
npm test --workspace=@organator/data-isolation
npm run build --workspace=@organator/data-isolation
git diff --check
```

Expected: tests pass; package builds; no whitespace errors.

- [ ] **Step 6: Commit contracts**

```bash
git add packages/data-isolation package-lock.json
git commit -m "feat(isolation): add provider-neutral contracts"
```

---

### Task 3: Implement real PostgreSQL isolation for all three modes

**Files:**
- Create: `packages/data-isolation/src/postgres/admin.ts`
- Create: `packages/data-isolation/src/postgres/shared.ts`
- Create: `packages/data-isolation/src/postgres/dedicated.ts`
- Create: `packages/data-isolation/src/postgres/adapter.ts`
- Create: `packages/data-isolation/src/postgres/postgres.integration.test.ts`
- Modify: `packages/data-isolation/src/index.ts`

**Interfaces:**
- Consumes: Task 2 contracts and `TEST_DATABASE_URL` administrative PostgreSQL connection.
- Produces: `PostgresIsolationAdapter` with idempotent target creation and opaque connection storage callback.

- [ ] **Step 1: Start the disposable PostgreSQL and prove integration tests are red**

```bash
docker compose up -d postgres
TEST_DATABASE_URL=postgresql://organator:password@localhost:5433/organator_db npm test --workspace=@organator/data-isolation
```

Add a test that instantiates `PostgresIsolationAdapter`, provisions tenant A and B in each mode, and asserts `prepareTarget()` returns stable role/schema/database identifiers on repeated calls.

Expected: FAIL because `PostgresIsolationAdapter` is not exported.

- [ ] **Step 2: Add the administrative SQL boundary**

`PostgresAdmin` owns a `pg.Pool` and these exact methods:

```ts
class PostgresAdmin {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  databaseExists(name: string): Promise<boolean>;
  roleExists(name: string): Promise<boolean>;
  schemaExists(name: string): Promise<boolean>;
  close(): Promise<void>;
}
```

All values use `$1` parameters. The only identifier interpolation passes through:

```ts
export function quoteIdentifier(value: string): string {
  if (!/^org_(role|schema|db)_[a-f0-9]{12}$/.test(value)) throw new IsolationError('ISOLATION_IDENTIFIER_INVALID', 'Generated PostgreSQL identifier is invalid');
  return `"${value}"`;
}
```

Role/database DDL that needs a password must first call PostgreSQL `format()` through a parameterized `SELECT`, using `%I` for the validated identifier and `%L` for the password, then execute only the returned server-formatted statement. Never concatenate a password into SQL in application code.

- [ ] **Step 3: Implement SHARED with forced RLS**

Create protected schema/table/function idempotently:

```sql
CREATE SCHEMA IF NOT EXISTS organator_guard;
REVOKE ALL ON SCHEMA organator_guard FROM PUBLIC;
CREATE TABLE IF NOT EXISTS organator_guard.tenant_roles (
  role_name name PRIMARY KEY,
  tenant_id text NOT NULL UNIQUE
);
```

The SECURITY DEFINER function must set an empty `search_path`, query the protected mapping by `session_user`, and return `NULL` for unknown roles. For each manifest table, verify `tenant_id` exists, then execute `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a policy equivalent to:

```sql
USING (
  tenant_id = organator_guard.tenant_for_role(session_user)
  AND tenant_id = current_setting('app.tenant_id', true)
)
WITH CHECK (
  tenant_id = organator_guard.tenant_for_role(session_user)
  AND tenant_id = current_setting('app.tenant_id', true)
)
```

The adapter verifies both `tenantColumn` and `primaryKey` exist before applying a policy. The tenant role is `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` and receives only required schema/table/sequence privileges.

- [ ] **Step 4: Implement SCHEMA and DATABASE targets**

For `SCHEMA`, create the stable schema and role, revoke `public`, grant only the tenant schema, and return a connection whose options set `search_path=<tenant schema>`.

For `DATABASE`, create the stable database and role only when absent, execute `REVOKE CONNECT ON DATABASE <generated database> FROM PUBLIC`, grant `CONNECT` only to its tenant role and the administrative role, and run migrations through a pool connected to the target database. Tests must prove a different generated tenant role cannot connect.

Generate role passwords with `randomBytes(32).toString('base64url')`. Pass plaintext only to the injected `storeConnection(input)` callback, which returns a `StoredConnection` containing an opaque reference and ciphertext payload; do not store or log plaintext inside the package.

- [ ] **Step 5: Prove cross-tenant isolation and spoof resistance**

The integration suite must, for two tenants in each mode:

```ts
await tenantA.query('BEGIN');
await tenantA.query("SET LOCAL app.tenant_id = $1", [tenantAId]);
await tenantA.query('INSERT INTO app.records (tenant_id, value) VALUES ($1, $2)', [tenantAId, 'A']);
await tenantA.query('COMMIT');

await tenantA.query('BEGIN');
await tenantA.query("SET LOCAL app.tenant_id = $1", [tenantBId]);
const spoofed = await tenantA.query('SELECT value FROM app.records');
assert.deepEqual(spoofed.rows, []);
await tenantA.query('ROLLBACK');
```

Also assert missing context is empty/denied, schema roles cannot read the other schema, database roles cannot connect to the other database, and repeated provisioning returns the same resources.

- [ ] **Step 6: Run integration tests and commit**

```bash
TEST_DATABASE_URL=postgresql://organator:password@localhost:5433/organator_db npm test --workspace=@organator/data-isolation
npm run build --workspace=@organator/data-isolation
git diff --check
git add packages/data-isolation/src/postgres packages/data-isolation/src/index.ts
git commit -m "feat(isolation): enforce postgres tenant boundaries"
```

---

### Task 4: Implement copy, validation, cutover, and rollback semantics

**Files:**
- Modify: `packages/data-isolation/src/postgres/adapter.ts`
- Create: `packages/data-isolation/src/postgres/migration.integration.test.ts`
- Modify: `packages/data-isolation/src/types.ts`

**Interfaces:**
- Consumes: provisioned source/target resources and `IsolationManifest`.
- Produces: working `copyData()`, `validate()`, `activate()`, `compensate()`, and `rollback()` behavior for all six directed transitions.

- [ ] **Step 1: Write the six-transition failing matrix**

```ts
const transitions: Array<[DataIsolationMode, DataIsolationMode]> = [
  ['SHARED', 'SCHEMA'], ['SCHEMA', 'SHARED'],
  ['SHARED', 'DATABASE'], ['DATABASE', 'SHARED'],
  ['SCHEMA', 'DATABASE'], ['DATABASE', 'SCHEMA'],
];

for (const [sourceMode, targetMode] of transitions) {
  test(`${sourceMode} -> ${targetMode} preserves rows and checksum`, async () => {
    const result = await harness.migrate({ sourceMode, targetMode, tenantId: 'tenant-a' });
    assert.equal(result.validation.rowCounts.records, 3);
    assert.equal(result.validation.checksums.records, result.sourceChecksum);
  });
}
```

Expected: FAIL because copy/cutover/rollback are not implemented.

- [ ] **Step 2: Add connection resolution and streaming copy**

Extend the context with an injected connection resolver and secret writer:

```ts
resolveConnection(reference: ConnectionReference): Promise<string>;
storeConnection(input: { tenantId: string; mode: DataIsolationMode; url: string }): Promise<StoredConnection>;
```

Copy rows in deterministic primary-key order in batches of exactly `500`. SHARED reads always begin a transaction and set the protected tenant context. Imports use parameterized inserts and preserve the manifest tenant column.

- [ ] **Step 3: Implement validation and fail-closed cutover**

For every declared table, compare source/target counts and SHA-256 checksums over stable JSON rows ordered by primary key. Then call `manifest.validate()`. Throw `ISOLATION_VALIDATION_FAILED` on any mismatch; never call `activate()` after a mismatch.

`activate()` returns `{ storedConnection, cleanupAfter }` only after validation evidence exists. `storedConnection.reference` is opaque, `storedConnection.encryptedPayload` contains ciphertext only, and `cleanupAfter` is an ISO timestamp calculated from the configured rollback window. It must not mutate Control Plane metadata itself; that atomic metadata update belongs to Task 6's repository transaction.

- [ ] **Step 4: Implement compensation and rollback resource rules**

Before cutover, `compensate()` drops only target resources whose identifiers match the current generation's persisted `resourceIds`. After cutover, `rollback()` requires `context.sourceConnection`, validates it, returns that previous connection reference, and only then compensates the target.

`cleanupSource()` runs only from a delayed cleanup job whose persisted generation, source identifiers, `cleanupAfter`, successful backup/empty-source confirmation, and active target reference all still match. SHARED cleanup deletes only rows selected under the protected tenant role/context; SCHEMA cleanup drops only the validated generated source schema/role; DATABASE cleanup terminates only connections to the validated generated source database, then drops that database/role. Any mismatch fails closed without deleting resources.

Never drop the source in this task. Return `cleanupAfter` as `cutoverAt + DATA_ISOLATION_ROLLBACK_HOURS`, default `24`.

- [ ] **Step 5: Prove failure paths**

Add tests for checksum mismatch before cutover, connection activation failure, rollback validation failure, and retry after partial target creation. Assert the original connection remains active in every failed pre-cutover case.

- [ ] **Step 6: Run tests and commit**

```bash
TEST_DATABASE_URL=postgresql://organator:password@localhost:5433/organator_db npm test --workspace=@organator/data-isolation
npm run build --workspace=@organator/data-isolation
git diff --check
git add packages/data-isolation/src
git commit -m "feat(isolation): migrate postgres tenant data safely"
```

---

### Task 5: Add authorized Control Plane commands and plan resolution

**Files:**
- Create: `apps/control-plane-api/src/data-isolation/data-isolation.types.ts`
- Create: `apps/control-plane-api/src/data-isolation/data-isolation.service.ts`
- Create: `apps/control-plane-api/src/data-isolation/data-isolation.service.spec.ts`
- Create: `apps/control-plane-api/src/data-isolation/data-isolation.controller.ts`
- Create: `apps/control-plane-api/src/data-isolation/data-isolation.controller.spec.ts`
- Create: `apps/control-plane-api/src/data-isolation/data-isolation.module.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Modify: `apps/control-plane-api/src/tenants/tenants.service.ts`
- Modify: `apps/control-plane-api/src/tenants/tenants.service.spec.ts`
- Modify: `apps/control-plane-api/src/billing/billing-plans.service.ts`
- Modify: `apps/control-plane-api/src/billing/billing-plans.service.spec.ts`
- Modify: `apps/control-plane-api/src/services/services.service.ts`
- Modify: `apps/control-plane-api/src/services/services.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 Prisma models and the `provisioner` BullMQ queue.
- Produces: safe read DTOs, platform override/reconcile commands, plan-change generation increments, job payload v1, and an opaque Data Plane connection reference on microservice deploy jobs.

- [ ] **Step 1: Write failing mode-resolution and authorization tests**

Cover these exact cases:

```ts
it.each([
  ['free', 'SHARED'], ['pro', 'SCHEMA'], ['enterprise', 'DATABASE'],
])('maps %s to %s without an override', (plan, expected) => {
  expect(planDefaultIsolation(plan)).toBe(expected);
});

it('keeps an explicit Platform Admin override during plan change', async () => {
  prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', plan: 'free', dataIsolation: 'DATABASE', dataIsolationOverridden: true, dataPlane: { generation: 4 } });
  const result = await service.applyPlanDefault('tenant-1', 'pro', 'actor-1');
  expect(result.desiredMode).toBe('DATABASE');
  expect(prisma.tenantDataPlane.update).not.toHaveBeenCalled();
  expect(queue.add).not.toHaveBeenCalled();
});

it('clears an override and reapplies the current plan default once', async () => {
  prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', plan: 'pro', dataIsolation: 'DATABASE', dataIsolationOverridden: true, dataPlane: { generation: 4, observedGeneration: 4 } });
  prisma.tenantDataPlane.upsert.mockResolvedValue({ generation: 5 });
  await service.setOverride('tenant-1', { mode: null }, 'actor-1');
  expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({ data: { dataIsolation: 'SCHEMA', dataIsolationOverridden: false } }));
  expect(queue.add).toHaveBeenCalledTimes(1);
  expect(queue.add).toHaveBeenCalledWith('reconcile-data-isolation', expect.objectContaining({ tenantId: 'tenant-1', generation: 5, desiredMode: 'SCHEMA' }), expect.objectContaining({ jobId: 'data-isolation:tenant-1:generation:5' }));
});

it('returns the existing deployment for a duplicate generation', async () => {
  prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', plan: 'pro', dataIsolation: 'SCHEMA', dataIsolationOverridden: false, dataPlane: { generation: 5, observedGeneration: 4, status: 'PENDING' } });
  prisma.deployment.findUnique.mockResolvedValue({ id: 'deployment-5', idempotencyKey: 'data-isolation:tenant-1:generation:5' });
  const result = await service.reconcile('tenant-1', 'actor-1');
  expect(result.deploymentId).toBe('deployment-5');
  expect(queue.add).not.toHaveBeenCalled();
});

it('never includes encrypted connection or raw resource state in the view', () => {
  const view = toDataIsolationView({ tenantId: 'tenant-1', dataIsolation: 'SCHEMA', dataIsolationOverridden: false, dataPlane: { activeIsolation: 'SHARED', status: 'READY', phase: 'READY', generation: 2, observedGeneration: 1, encryptedConnection: { url: 'ciphertext' }, resourceState: { database: 'secret-name' }, lastError: null, updatedAt: new Date('2026-08-15T00:00:00Z') } });
  expect(view).toEqual(expect.objectContaining({ tenantId: 'tenant-1', desiredMode: 'SCHEMA', activeMode: 'SHARED' }));
  expect(view).not.toHaveProperty('encryptedConnection');
  expect(view).not.toHaveProperty('resourceState');
});
```

Controller tests must prove `@Roles('PLATFORM_ADMIN')` on mutation endpoints and tenant-derived context on read endpoints.

Run the focused specs; expect FAIL because the module does not exist.

- [ ] **Step 2: Define validated inputs and safe output**

```ts
export const DATA_ISOLATION_MODES = ['SHARED', 'SCHEMA', 'DATABASE'] as const;
export interface IsolationOverrideInput { mode: typeof DATA_ISOLATION_MODES[number] | null; confirmDestructive?: boolean }
export interface DataIsolationView {
  tenantId: string;
  desiredMode: typeof DATA_ISOLATION_MODES[number];
  activeMode: typeof DATA_ISOLATION_MODES[number] | null;
  overridden: boolean;
  status: 'PENDING' | 'RECONCILING' | 'READY' | 'FAILED';
  phase: string;
  generation: number;
  observedGeneration: number;
  lastError: string | null;
  updatedAt: Date;
}
```

Reject unknown modes with `BadRequestException`. A destructive change from `DATABASE` or `SCHEMA` to a less isolated mode requires `confirmDestructive === true` and an existing rollback reference in safe resource metadata.

- [ ] **Step 3: Implement one transactional generation update**

Inside a Prisma transaction:

1. Lock/read tenant, billing plan, and data-plane binding.
2. Resolve desired mode from override or `BillingPlan.defaultDataIsolation`.
3. If desired mode is unchanged, return the existing operation.
4. Update `Tenant.dataIsolation` and override flag.
5. Upsert `TenantDataPlane`, incrementing `generation` exactly once and setting `PENDING`/`PREPARE`.
6. After transaction commit, enqueue:

```ts
{
  apiVersion: 'organator.io/v1alpha1',
  tenantId,
  generation,
  desiredMode,
  actorId,
  deploymentId,
}
```

with `jobId: data-isolation:<tenantId>:generation:<generation>`, `attempts: 5`, and exponential backoff starting at `1000` ms.

- [ ] **Step 4: Add endpoints and audit records**

```ts
@Get('v1/tenants/data-isolation')
@Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')

@Put('v1/platform/tenants/:tenantId/data-isolation')
@Roles('PLATFORM_ADMIN')

@Post('v1/platform/tenants/:tenantId/data-isolation/reconcile')
@Roles('PLATFORM_ADMIN')
```

The tenant read endpoint uses only `req.user.tenantId`. Mutations audit `tenant.data_isolation.override_changed` and `tenant.data_isolation.reconcile_requested` with modes, generation, actor, tenant, and deployment ID only.

- [ ] **Step 5: Integrate plan CRUD and tenant plan changes**

Billing plan create/update accepts `defaultDataIsolation`, validates it against the exact three modes, and defaults missing values using the mapping table. `TenantsService.changePlan()` updates desired mode and queues reconciliation only when `dataIsolationOverridden` is false.

- [ ] **Step 6: Attach only an opaque connection reference to product deploys**

Extend `ServicesService.triggerDeploy()` to load the service tenant's `TenantDataPlane`. When status is `READY`, add only this object to the BullMQ payload:

```ts
dataPlaneConnectionRef: {
  tenantId: service.tenantId,
  generation: dataPlane.observedGeneration,
  referenceId: String((dataPlane.resourceState as Record<string, unknown>).activeConnectionReference),
}
```

Never add `encryptedConnection` or a URL. When `DATA_ISOLATION_ENABLED=true`, reject a deployment whose binding exists but is not `READY`; when the feature is disabled or no binding exists, preserve the existing deployment behavior. Tests assert the queued payload contains the reference and does not contain `url`, `password`, `encryptedConnection`, or `resourceState`.

- [ ] **Step 7: Run focused and full API tests**

```bash
npm run test --workspace=control-plane-api -- data-isolation --runInBand
npm run test --workspace=control-plane-api -- --runInBand
npm run build --workspace=control-plane-api
git diff --check
```

Expected: all  existing and new suites pass; API builds.

- [ ] **Step 8: Commit API commands**

```bash
git add apps/control-plane-api/src/data-isolation apps/control-plane-api/src/app.module.ts apps/control-plane-api/src/tenants apps/control-plane-api/src/billing apps/control-plane-api/src/services
git commit -m "feat(api): manage tenant isolation generations"
```

---

### Task 6: Extract and implement the worker reconciliation state machine

**Files:**
- Modify: `apps/provisioner-worker/package.json`
- Modify: `package-lock.json`
- Create: `apps/provisioner-worker/src/data-isolation/repository.ts`
- Create: `apps/provisioner-worker/src/data-isolation/reconciler.ts`
- Create: `apps/provisioner-worker/src/data-isolation/reconciler.test.ts`
- Create: `apps/provisioner-worker/src/data-isolation/job-handler.ts`
- Create: `apps/provisioner-worker/src/data-isolation/job-handler.test.ts`
- Create: `apps/provisioner-worker/src/data-isolation/connection-resolver.ts`
- Create: `apps/provisioner-worker/src/data-isolation/connection-resolver.test.ts`
- Create: `apps/provisioner-worker/src/worker.ts`
- Modify: `apps/provisioner-worker/src/index.ts`

**Interfaces:**
- Consumes: Task 2 `IsolationAdapter`, Task 5 job payload, Prisma `TenantDataPlane`, and BullMQ.
- Produces: testable `reconcileDataIsolation()`, delayed source cleanup, and a worker factory handling `reconcile-data-isolation` plus `cleanup-data-isolation-source` without import-time side effects.

- [ ] **Step 1: Add worker test/build dependencies and a red state-machine test**

Add `@organator/data-isolation: "*"`, `prom-client: "^15.1.3"`, `tsx: "^4.23.12"`, and script `"test": "tsx --test src/**/*.test.ts"`.

The first test uses a fake repository and adapter and expects phase order:

```ts
assert.deepEqual(repository.savedPhases, [
  'PREPARE', 'PROVISION_TARGET', 'APPLY_MIGRATIONS',
  'COPY', 'VALIDATE', 'CUTOVER', 'READY',
]);
assert.equal(repository.binding.activeIsolation, 'SCHEMA');
assert.equal(repository.binding.observedGeneration, 2);
```

Expected: FAIL because `reconcileDataIsolation()` does not exist.

- [ ] **Step 2: Define the repository transaction boundary**

`IsolationRepository` exposes:

```ts
load(tenantId: string): Promise<IsolationSnapshot>;
withTenantLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
checkpoint(input: { tenantId: string; generation: number; phase: IsolationPhase; resourceState?: Record<string, unknown>; lastError?: string | null }): Promise<void>;
cutover(input: { tenantId: string; generation: number; mode: DataIsolationMode; storedConnection: StoredConnection; resourceState: Record<string, unknown> }): Promise<void>;
fail(input: { tenantId: string; generation: number; phase: IsolationPhase; code: string; message: string }): Promise<void>;
recordAudit(input: { tenantId: string; generation: number; deploymentId: string; action: string; changes: Record<string, string | number | null> }): Promise<void>;
```

`withTenantLock()` uses `pg_advisory_xact_lock(hashtextextended(tenantId, 0))`. `cutover()` atomically verifies the generation, updates active mode/observed generation/connection, and marks `READY`.

- [ ] **Step 3: Implement phase persistence and stale-job rejection**

After acquiring the lock, reload the snapshot. If payload generation differs from current generation, return `{ status: 'STALE' }` without adapter calls. Otherwise persist each phase after its corresponding adapter method succeeds.

On recoverable failure, sanitize and rethrow after persisting `FAILED`; BullMQ performs bounded retries. On retry, derive the first unfinished phase from persisted checkpoints/resource state.

- [ ] **Step 4: Implement compensation and rollback tests**

Tests must cover:

- failure in `COPY` compensates target and preserves active connection;
- failure in `VALIDATE` never calls cutover;
- failure after cutover validates and restores the source reference;
- failed rollback preserves both resource references and emits critical status;
- retry resumes without a second `prepareTarget()` resource creation;
- all six source/target mode pairs call the same state machine.
- delayed cleanup is a no-op for stale generation, changed active reference, missing backup confirmation, or an unexpired `cleanupAfter`;
- valid delayed cleanup calls `cleanupSource()` exactly once and records sanitized completion audit.

- [ ] **Step 5: Extract the worker factory**

`worker.ts` exports `createProvisionerWorker(dependencies)` and registers all existing handlers plus `reconcile-data-isolation` and `cleanup-data-isolation-source`. After cutover, enqueue cleanup with `jobId: data-isolation-cleanup:<tenantId>:generation:<generation>` and delay `cleanupAfter - now`. The cleanup handler reloads/locks state and calls `cleanupSource()` only when every persisted guard still matches. `index.ts` only constructs Prisma/Redis/adapters, calls the factory, installs signal handlers, and starts the process. Importing `worker.ts` in tests must not open Redis, Prisma, or worker-thread connections.

`IsolationRepository.cutover()` stores `storedConnection.encryptedPayload` in `encryptedConnection` and stores `storedConnection.reference.id` as `resourceState.activeConnectionReference` in the same transaction.

- [ ] **Step 6: Resolve the active Data Plane secret only inside the worker**

`resolveDataPlaneConnection(ref)` queries `TenantDataPlane` by `tenantId`, verifies `status === 'READY'`, `observedGeneration === ref.generation`, and the persisted `activeConnectionReference === ref.referenceId`, then decrypts the stored URL with the existing AES-256-GCM utility. A mismatch fails closed with `ISOLATION_CONNECTION_STALE`.

Pass the plaintext URL only as the `DATABASE_URL` provider environment variable. Extend Vercel `injectEnvVar()` and VPS `deployDockerContainer()` calls without logging the value. Tests use sentinel `postgresql://user:super-secret@db/app` and assert it reaches the mocked provider once while every logger call and serialized job/result omits `super-secret`.

- [ ] **Step 7: Run worker tests/build and commit**

```bash
npm test --workspace=provisioner-worker
npm run build --workspace=provisioner-worker
npm run test --workspace=control-plane-api -- --runInBand
git diff --check
git add apps/provisioner-worker package-lock.json
git commit -m "feat(worker): reconcile tenant isolation safely"
```

---

### Task 7: Add authenticated SSE, audit lifecycle events, and metrics

**Files:**
- Create: `apps/control-plane-api/src/data-isolation/data-isolation-events.service.ts`
- Create: `apps/control-plane-api/src/data-isolation/data-isolation-events.service.spec.ts`
- Modify: `apps/control-plane-api/src/data-isolation/data-isolation.controller.ts`
- Modify: `apps/control-plane-api/src/data-isolation/data-isolation.controller.spec.ts`
- Modify: `apps/control-plane-api/src/data-isolation/data-isolation.module.ts`
- Create: `apps/provisioner-worker/src/data-isolation/metrics.ts`
- Create: `apps/provisioner-worker/src/data-isolation/metrics.test.ts`
- Create: `apps/provisioner-worker/src/data-isolation/metrics-server.ts`
- Create: `apps/provisioner-worker/src/data-isolation/metrics-server.test.ts`
- Modify: `apps/provisioner-worker/src/data-isolation/reconciler.ts`
- Modify: `apps/provisioner-worker/src/index.ts`

**Interfaces:**
- Consumes: tenant/deployment ownership, Redis events, reconciler phases.
- Produces: tenant-scoped SSE and Prometheus metrics without secret-bearing labels.

- [ ] **Step 1: Write failing SSE ownership tests**

Prove:

```ts
await expect(events.stream({ tenantId: 'tenant-a', deploymentId: 'dep-b' })).rejects.toThrow('Deployment not found');
expect(redis.subscribe).not.toHaveBeenCalled();
```

For an owned deployment, assert the channel is derived server-side as `data_isolation:<tenantId>:<deploymentId>` and emitted data contains only `deploymentId`, `generation`, `phase`, `status`, `timestamp`, and sanitized `message`.

- [ ] **Step 2: Implement the authenticated endpoint**

```ts
@Sse('v1/tenants/data-isolation/stream/:deploymentId')
@Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
stream(@Req() req: any, @Param('deploymentId') deploymentId: string) {
  return this.events.stream({ tenantId: req.user.tenantId, deploymentId });
}
```

Before subscribing, query `Deployment` with both `id` and authenticated `tenantId`. Close Redis listeners on unsubscribe and heartbeat every 15 seconds without leaking internal state.

- [ ] **Step 3: Add lifecycle audit events**

The worker publishes versioned internal phase events and calls `IsolationRepository.recordAudit()` for started, cutover, completed, failed, and rolled-back actions. Audit changes contain tenant, generation, deployment, source/target modes, phase, result, and stable error code only. Audit failure is best-effort and must not change reconciliation state.

- [ ] **Step 4: Add exact metrics**

Use `prom-client` without tenant IDs as labels:

```ts
organator_data_isolation_reconciliations_total{source_mode,target_mode,result}
organator_data_isolation_phase_duration_seconds{phase,target_mode,result}
organator_data_isolation_retries_total{phase,target_mode}
organator_data_isolation_compensations_total{stage,result}
organator_data_isolation_pending_age_seconds
```

Tests assert no metric label name includes `tenant`, `connection`, `password`, or `resource_id`.

Expose the worker registry through a minimal Node HTTP server bound to `METRICS_HOST` (default `127.0.0.1`) and `METRICS_PORT` (default `9464`). Only `GET /metrics` returns `registry.metrics()` with the Prometheus content type; every other path returns `404`. Start and close this server from `index.ts` signal handling. Its tests bind port `0`, assert the metrics response, and close the server.

- [ ] **Step 5: Run focused suites and commit**

```bash
npm run test --workspace=control-plane-api -- data-isolation --runInBand
npm test --workspace=provisioner-worker
npm run build --workspace=control-plane-api
npm run build --workspace=provisioner-worker
git diff --check
git add apps/control-plane-api/src/data-isolation apps/provisioner-worker/src/data-isolation
git commit -m "feat(isolation): stream secure reconciliation status"
```

---

### Task 8: Add Platform Admin controls and tenant read-only status

**Files:**
- Modify: `apps/backoffice-web/src/app/(dashboard)/tenants/actions.ts`
- Create: `apps/backoffice-web/src/app/(dashboard)/tenants/data-isolation.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/tenants/ClientPage.tsx`
- Create: `apps/backoffice-web/src/app/(dashboard)/settings/data-isolation-card.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/settings/page.tsx`
- Create: `e2e/tests/data-isolation.spec.ts`

**Interfaces:**
- Consumes: Task 5 read/mutation endpoints and Task 7 SSE payload.
- Produces: Platform Admin selector/confirmation and Tenant Owner/Admin badge/stepper.

- [ ] **Step 1: Write failing Playwright role/visibility tests**

Cover these exact behaviors:

```ts
test('platform admin can select an isolation override', async ({ page }) => {
  await page.goto('/tenants');
  await expect(page.getByRole('combobox', { name: 'Isolamento de dados' })).toBeVisible();
});

test('tenant owner sees status but no selector', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByText('Isolamento do Data Plane')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Isolamento de dados' })).toHaveCount(0);
});
```

Mock API fixtures must include desired/active modes, status, phase, generation, and no secret fields.

- [ ] **Step 2: Add strict server actions**

```ts
export async function updateDataIsolation(tenantId: string, mode: 'SHARED' | 'SCHEMA' | 'DATABASE' | null, confirmDestructive = false): Promise<void>;
export async function reconcileDataIsolation(tenantId: string): Promise<void>;
```

Both actions require a session whose role is exactly `PLATFORM_ADMIN`, call the platform endpoints, surface the API's sanitized message on failure, and revalidate `/tenants`.

- [ ] **Step 3: Implement the Platform Admin panel**

The panel shows plan default, desired mode, active mode, override marker, status, and phase. Options have copy:

- `SHARED — menor custo, RLS por tenant`
- `SCHEMA — schema e role exclusivos`
- `DATABASE — database e credencial exclusivos`
- `Usar padrão do plano`

Moving from DATABASE/SCHEMA toward less isolation opens an explicit confirmation describing read-only migration and 24-hour rollback retention. The action remains disabled while status is `RECONCILING`.

- [ ] **Step 4: Implement the tenant read-only card and stepper**

Show desired/active badges and ordered phases `PREPARE`, `PROVISION_TARGET`, `APPLY_MIGRATIONS`, `COPY`, `VALIDATE`, `CUTOVER`, `READY`. Subscribe to SSE only when a deployment ID exists. On `FAILED`, show only the sanitized message and instruct the tenant to contact support; do not expose retry controls.

- [ ] **Step 5: Run lint/build/E2E and commit**

```bash
npx eslint 'apps/backoffice-web/src/app/(dashboard)/tenants/**/*.{ts,tsx}' 'apps/backoffice-web/src/app/(dashboard)/settings/**/*.{ts,tsx}'
npm run build --workspace=backoffice-web
npx playwright test e2e/tests/data-isolation.spec.ts
git diff --check
git add apps/backoffice-web/src/app/'(dashboard)'/tenants apps/backoffice-web/src/app/'(dashboard)'/settings e2e/tests/data-isolation.spec.ts
git commit -m "feat(web): manage tenant data isolation"
```

---

### Task 9: Prove rollout, rollback, and whole-repository readiness

**Files:**
- Create: `docs/runbooks/data-plane-isolation.md`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `prometheus.yml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: disabled-by-default rollout, PostgreSQL integration CI, operator runbook, and merge evidence for issue #49.

- [ ] **Step 1: Add explicit rollout configuration**

Document and configure:

```dotenv
DATA_ISOLATION_ENABLED=false
DATA_ISOLATION_ADMIN_URL=postgresql://organator:password@postgres:5432/organator_db
DATA_ISOLATION_ROLLBACK_HOURS=24
METRICS_HOST=0.0.0.0
METRICS_PORT=9464
```

Production startup must reject `DATA_ISOLATION_ENABLED=true` when `DATA_ISOLATION_ADMIN_URL` or a valid 64-hex `ENCRYPTION_KEY` is missing. Disabled mode keeps existing tenant behavior unchanged and returns a stable feature-disabled response from mutation endpoints.

Add the worker metrics port to Compose and a Prometheus scrape target `provisioner-worker:9464`; do not publish the metrics port to the public host interface in production documentation.

- [ ] **Step 2: Write the operator runbook**

The runbook contains exact sections:

1. prerequisites and role privileges;
2. enablement validation;
3. batch rollout for existing tenants;
4. phase/status interpretation;
5. alert thresholds: pending over 15 minutes, three consecutive failures, any failed rollback, cleanup overdue after 24 hours;
6. retry procedure;
7. pre-cutover compensation;
8. post-cutover rollback;
9. guarded metadata rollback SQL;
10. handoff contract for issues #36, #50, and #51.

- [ ] **Step 3: Add PostgreSQL integration CI**

Extend the existing build job with a PostgreSQL 15 service and run:

```bash
TEST_DATABASE_URL=postgresql://organator:password@localhost:5432/organator_db npm test --workspace=@organator/data-isolation
npm test --workspace=provisioner-worker
npm run test --workspace=control-plane-api -- --runInBand
```

Use a health check with `pg_isready -U organator -d organator_db`; never print `DATA_ISOLATION_ADMIN_URL` or `ENCRYPTION_KEY`.

- [ ] **Step 4: Run the complete local verification matrix**

```bash
npm ci
npm run generate --workspace=@organator/core-models
docker compose up -d postgres redis
TEST_DATABASE_URL=postgresql://organator:password@localhost:5433/organator_db npm test --workspace=@organator/data-isolation
npm test --workspace=provisioner-worker
npm run test --workspace=control-plane-api -- --runInBand
npx turbo lint
npx turbo build
npx playwright test e2e/tests/data-isolation.spec.ts
git diff --check
git status --short
```

Expected: all tests/builds pass; lint has zero errors; only planned tracked files are present. If lint applies formatting outside scope, restore those lint-only changes before committing.

- [ ] **Step 5: Commit rollout readiness**

```bash
git add docs/runbooks/data-plane-isolation.md .env.example docker-compose.yml prometheus.yml .github/workflows/ci.yml
git commit -m "docs(isolation): add safe rollout and rollback"
```

- [ ] **Step 6: Push and open the implementation PR**

```bash
git push -u origin feat/issue-49-data-isolation
gh pr create --base main --head feat/issue-49-data-isolation --title "feat(v2.2.0): add tenant data isolation models" --body "Closes #49\n\nImplements SHARED/RLS, SCHEMA, and DATABASE Data Plane isolation with generation-based reconciliation, rollback, authorized controls, and PostgreSQL integration tests. Cloud server/network/DNS lifecycle remains #36."
```

Expected: one PR linked to #49, with CI green before merge. Do not close #49 manually before the merge commit lands.

---

## Final Acceptance Checklist

- [ ] `main` remained untouched during implementation; all work is on `feat/issue-49-data-isolation`.
- [ ] Control Plane Prisma still uses one centralized datasource.
- [ ] Plan defaults and Platform Admin override semantics match the exact mapping.
- [ ] Existing tenants are not silently marked Data Plane `READY`.
- [ ] SHARED forced RLS blocks missing context and spoofed tenant context.
- [ ] SCHEMA and DATABASE roles cannot cross tenant boundaries.
- [ ] All six directed mode migrations preserve counts/checksums.
- [ ] Pre-cutover failure compensates without changing active mode.
- [ ] Post-cutover failure rolls back or raises a critical failed-rollback state with both references preserved.
- [ ] Retry/stale generation/idempotency behavior is proved.
- [ ] API mutations are Platform Admin-only; tenant reads and SSE are tenant-scoped.
- [ ] No secret-bearing field appears in API, SSE, logs, audit, or metric labels.
- [ ] UI shows controls only to Platform Admin and status only to tenant roles.
- [ ] Feature is disabled by default and production configuration fails closed.
- [ ] Unit, PostgreSQL integration, worker, API, UI E2E, lint, and build checks pass.
- [ ] PR documents dependencies: #36 consumes connection references, #50 embeds the manifest, and #51 owns retention-aware permanent cleanup.

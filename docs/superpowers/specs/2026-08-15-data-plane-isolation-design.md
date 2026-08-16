# Data Plane Isolation Design — Issue #49

**Date:** 2026-08-15  
**Issue:** [#49 — modelos de isolamento de dados](https://github.com/wendelmax/organator-cloud/issues/49)  
**Milestone:** v2.2.0 — Provisioner & Providers One-Click

## Context

Organator already keeps Control Plane records tenant-scoped with `tenantId`, but the tenant infrastructure flow does not define how product databases are isolated. Issue #36 promises an isolated database while the worker currently records phases without creating databases, schemas, roles, or policies.

This design separates two concerns:

- The **Control Plane database remains centralized**. Users, memberships, billing, audit, deployments, provider profiles, and tenant metadata continue to use the existing Prisma datasource and tenant authorization rules.
- The **Data Plane databases used by tenant products** support three isolation modes: shared database with RLS, schema per tenant, and database per tenant.

The design delivers real PostgreSQL behavior locally and through a provider-neutral contract. AWS RDS, VPS lifecycle, network, and DNS provisioning remain part of issue #36.

## Goals

- Allow `SHARED`, `SCHEMA`, and `DATABASE` tenants to coexist in one Organator installation.
- Derive the desired isolation mode from the billing plan while allowing an audited Platform Admin override.
- Reconcile desired and active isolation asynchronously and idempotently.
- Migrate between every pair of isolation modes with validation, controlled cutover, and rollback.
- Enforce PostgreSQL isolation with least-privilege roles and fail-closed behavior.
- Provide tenant-visible status without exposing credentials or infrastructure internals.
- Supply integration evidence for positive access, negative cross-tenant access, retry, rollback, and audit events.

## Non-goals

- Splitting the Organator Control Plane database by tenant.
- Creating AWS RDS instances, VPCs, security groups, VPS networks, or DNS records.
- Crossplane, Terraform, ResourceDefinitions, or the v3 composition engine.
- Zero-downtime dual-write migrations.
- Permanent source deletion before the rollback window expires.
- General-purpose application schema discovery. Products must declare their tenant-scoped tables and migrations.

## Decisions

### Plan defaults and ownership

The default mapping is:

| Plan | Default isolation |
| --- | --- |
| `free` | `SHARED` |
| `pro` | `SCHEMA` |
| `enterprise` | `DATABASE` |

`PLATFORM_ADMIN` may set or clear a tenant override. Tenant Owner and Tenant Admin can read the effective mode and reconciliation status but cannot change the mode. Clearing an override recalculates the desired mode from the current plan.

A plan change recalculates the desired mode only when the tenant does not have an explicit override. Any resulting change increments a generation and queues reconciliation.

### State model

Add Prisma enums:

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

Extend `BillingPlan` with:

- `defaultDataIsolation DataIsolationMode @default(SHARED)`

Extend `Tenant` with:

- `dataIsolation DataIsolationMode @default(SHARED)` — desired effective mode.
- `dataIsolationOverridden Boolean @default(false)` — whether the desired mode came from a Platform Admin override.
- one optional `TenantDataPlane` relation.

Add a one-to-one `TenantDataPlane` model containing:

- `tenantId` as a unique foreign key.
- `activeIsolation DataIsolationMode?`.
- `status DataPlaneStatus @default(PENDING)`.
- `phase String @default("PREPARE")`.
- `generation Int @default(1)`.
- `observedGeneration Int @default(0)`.
- `resourceState Json @default("{}")` for non-secret provider identifiers, source/target checkpoints, validation evidence, and rollback references.
- `encryptedConnection Json?` for AES-256-GCM encrypted connection material using the existing encryption utility.
- `lastError String?`, containing only a sanitized operator-facing error.
- `startedAt`, `completedAt`, `createdAt`, and `updatedAt` timestamps.

The existing `Deployment` model remains the operational history and SSE log source. A reconciliation uses the idempotency key `data-isolation:<tenantId>:generation:<generation>`. Retries for the same generation resume the same operation; a new desired mode creates a new generation.

### Existing tenants and schema rollout

The database migration is expand-only:

1. Add enums, nullable relation, and fields with safe defaults.
2. Backfill plan defaults (`free → SHARED`, `pro → SCHEMA`, `enterprise → DATABASE`).
3. Backfill each tenant's desired `dataIsolation` from its plan.
4. Do not silently mark an existing tenant Data Plane as `READY`. Create `TenantDataPlane` lazily during first reconciliation, or mark discovered existing resources as `PENDING` until validated.
5. Keep the previous application version compatible with the expanded schema, allowing application rollback without dropping data.

No destructive database migration is part of this delivery. A reviewed operator rollback script may remove the new metadata only after all reconcilers have been rolled back and no Data Plane binding depends on it.

## Architecture

### Components

#### `packages/data-isolation`

A new workspace package owns reusable contracts and PostgreSQL behavior:

- `IsolationManifest`: product identifier, migration runner, tenant-scoped table declarations, and validation hooks.
- `IsolationContext`: tenant, generation, source binding, target mode, provider configuration, and secret writer.
- `IsolationAdapter`: provider-neutral lifecycle interface.
- `PostgresIsolationAdapter`: real implementation for PostgreSQL.
- Identifier normalization, SQL quoting, resource-state types, validation, and error sanitization.

The adapter has explicit operations rather than one opaque method:

```ts
interface IsolationAdapter {
  prepareTarget(context: IsolationContext): Promise<TargetResources>;
  applyMigrations(context: IsolationContext, target: TargetResources): Promise<void>;
  copyData(context: IsolationContext, target: TargetResources): Promise<CopyEvidence>;
  validate(context: IsolationContext, target: TargetResources): Promise<ValidationEvidence>;
  activate(context: IsolationContext, target: TargetResources): Promise<ConnectionReference>;
  compensate(context: IsolationContext, target: TargetResources): Promise<void>;
}
```

Methods are idempotent: they first inspect persisted resource identifiers and provider state, then create or alter only what is missing.

#### `apps/provisioner-worker/src/data-isolation`

The worker owns orchestration, not SQL details:

- BullMQ job `reconcile-data-isolation`.
- Per-tenant PostgreSQL advisory lock plus generation check.
- Phase state machine and persisted checkpoints.
- Deployment logs and Redis events after each committed phase.
- Retry from the last successful phase.
- Compensation before cutover and rollback after cutover.

The existing monolithic worker entry point delegates to this module. This makes the state machine testable without starting a Redis worker at import time.

#### `apps/control-plane-api/src/data-isolation`

The API module owns:

- Effective-mode resolution from plan and override.
- Authorization and tenant scoping.
- Generation increments and job enqueueing.
- Read models that omit encrypted connection material and provider secrets.
- Authenticated, tenant-scoped SSE.
- Audit events for requested operations and administrative overrides.

#### Backoffice UI

- Platform tenant details gain an isolation selector, impact summary, explicit confirmation for destructive downgrade, and reconciliation action.
- Tenant organization settings show a read-only badge and phase stepper.
- Errors shown to tenant users are sanitized; operator detail remains in protected logs.

## Isolation Manifest

Organator cannot infer the ownership rules of arbitrary ERP, CRM, LMS, or HR tables. Each product supplies a versioned manifest:

```ts
interface IsolationManifest {
  apiVersion: 'organator.io/v1alpha1';
  product: string;
  migrations: MigrationRunner;
  tenantScopedTables: Array<{
    schema: string;
    table: string;
    tenantColumn: 'tenant_id';
  }>;
  validate(connection: ConnectionReference, tenantId: string): Promise<ValidationEvidence>;
}
```

The v1alpha1 manifest is deliberately smaller than issue #50's future declarative environment spec. Issue #50 may embed or reference it without changing the adapter lifecycle.

An empty tenant table declaration is allowed only for products that explicitly declare they contain no tenant-owned relational data. A declared table missing `tenant_id` fails reconciliation before cutover.

## PostgreSQL behavior

### Shared database with RLS

- Use a shared application database and schema.
- Create a dedicated login role for each tenant with no superuser, database creation, role creation, replication, or `BYPASSRLS` privileges.
- Maintain a protected mapping between PostgreSQL role and tenant ID in an Organator-owned schema.
- Enable and force RLS on every declared tenant-scoped table.
- Policies require both:
  - the protected role-to-tenant mapping to equal the row's `tenant_id`; and
  - `current_setting('app.tenant_id', true)` to equal the same tenant ID.
- The connection wrapper executes `SET LOCAL app.tenant_id = <tenantId>` inside every transaction.
- Application roles cannot modify the protected role mapping or disable RLS.
- A missing context, unknown role, missing `tenant_id`, or unprotected declared table fails closed.

The role mapping prevents a client from gaining access by setting `app.tenant_id` to another tenant. The session setting remains useful for transaction context and defense in depth.

### Schema per tenant

- Use a shared database with a generated schema name derived from a stable short tenant UUID, not a raw slug.
- Create a dedicated role and grant access only to that schema.
- Revoke role access to `public` and other tenant schemas.
- Run product migrations with an explicit restricted `search_path`.
- Configure the resulting tenant connection with the same restricted `search_path`.
- Validate that the role cannot list or read another tenant's application objects.

### Database per tenant

- Create a generated database and dedicated least-privilege owner/login role.
- Run product migrations against the new database.
- Generate a cryptographically random password.
- Encrypt connection material before persistence and return only an opaque connection reference.
- Validate that the role cannot connect to other tenant databases.

The PostgreSQL adapter may operate against local PostgreSQL, managed PostgreSQL, or a provider-supplied administrative endpoint. Creating the managed server itself belongs to issue #36.

## Reconciliation and migration

The phase sequence is:

```text
PREPARE → PROVISION_TARGET → APPLY_MIGRATIONS → COPY → VALIDATE → CUTOVER → READY
                                                                  ↓
                                                        ROLLBACK / FAILED
```

### Common rules

- Acquire a per-tenant advisory lock before reading or modifying resources.
- Re-read `generation` after acquiring the lock. A stale job exits without changing state.
- Persist provider identifiers immediately after successful creation.
- Never report success using fabricated or fallback resource IDs.
- Store secrets only through the encrypted secret writer.
- Emit a phase event only after its database checkpoint commits.

### Copy and validation

- The product migration runner exports tenant rows from the source and imports them into the target topology.
- `SHARED` sources always filter by the protected tenant context.
- Schema and database targets are empty or generation-owned before import.
- Validation compares table counts and manifest-provided checksums, then runs the product validation hook.
- Any mismatch blocks cutover.

### Cutover

- Enter a bounded maintenance/read-only window for the affected tenant.
- Re-run the final delta copy supported by the migration runner.
- Re-run validation.
- Atomically update the active encrypted connection reference, `activeIsolation`, and `observedGeneration`.
- Exit maintenance mode and mark the operation `READY`.

Dual-write is outside v2.2. The API and UI must state that an isolation migration may briefly make the tenant read-only.

### Rollback and cleanup

- Before cutover, compensation removes only generation-owned target resources.
- After cutover, rollback restores the previous connection reference and active mode, validates access, and then compensates the target.
- Keep the source for `DATA_ISOLATION_ROLLBACK_HOURS`, defaulting to 24 hours.
- Permanent cleanup runs as a separate idempotent job after the rollback window and requires a valid backup or manifest confirmation that the source is empty.
- Issue #51 will connect permanent cleanup to the full tenant offboarding policy. This delivery supplies the safe adapter operations and resource references but does not bypass retention policy.

All six directed mode transitions are supported and tested: SHARED↔SCHEMA, SHARED↔DATABASE, and SCHEMA↔DATABASE.

## API contract

### Tenant-scoped read APIs

- `GET /v1/tenants/data-isolation`
  - Roles: Tenant Owner, Tenant Admin, Platform Admin.
  - Returns desired mode, active mode, status, phase, generation, timestamps, and sanitized error.
  - Never returns `encryptedConnection` or raw `resourceState` secrets.
- `GET /v1/tenants/data-isolation/stream`
  - Same tenant authorization.
  - Streams phase/status changes from a channel bound to the authenticated tenant and deployment.

### Platform administration APIs

- `PUT /v1/platform/tenants/:tenantId/data-isolation`
  - Role: `PLATFORM_ADMIN` only.
  - Body: `{ mode: 'SHARED' | 'SCHEMA' | 'DATABASE' | null, confirmDestructive?: boolean }`.
  - `null` clears the override and reapplies the plan default.
  - A downgrade or replacement that may remove dedicated resources requires `confirmDestructive: true` and a valid rollback/backup policy.
- `POST /v1/platform/tenants/:tenantId/data-isolation/reconcile`
  - Role: `PLATFORM_ADMIN` only.
  - Retries the current generation or creates a job when desired and observed generations differ.

Commands return `202 Accepted` with deployment ID, generation, desired mode, and status. Duplicate requests return the existing operation.

## Events, audit, and observability

Audit actions:

- `tenant.data_isolation.override_changed`
- `tenant.data_isolation.reconcile_requested`
- `tenant.data_isolation.started`
- `tenant.data_isolation.cutover`
- `tenant.data_isolation.completed`
- `tenant.data_isolation.failed`
- `tenant.data_isolation.rolled_back`

Audit changes include tenant, actor, source/target modes, generation, deployment ID, and sanitized reason. They never contain passwords, connection strings, tokens, exported rows, or raw provider responses.

Structured metrics:

- reconciliation count and duration by source mode, target mode, phase, and result;
- retry and compensation counts;
- pending generation age;
- failures before and after cutover;
- rollback-window cleanup backlog.

Logs use tenant ID, deployment ID, generation, phase, and stable error code. Error messages pass through a sanitizer before persistence or SSE publication. Alerts cover stuck reconciliation, repeated failure, failed rollback, and expired cleanup backlog.

No external webhook is introduced by this issue. Internal Redis/BullMQ events remain versioned by job name and payload version; reliable outgoing event delivery remains issue #57.

## Security invariants

- Control Plane authorization is enforced by API guards and service-level tenant checks, not UI visibility.
- Only Platform Admin changes desired isolation.
- Tenant read APIs derive tenant context from the authenticated session and cannot accept an arbitrary tenant ID.
- PostgreSQL identifiers are generated and validated, then quoted by the adapter; raw slug or user input never becomes SQL.
- SQL values use parameters; identifiers use the adapter's strict identifier function.
- Application roles have no `BYPASSRLS`, role-management, database-management, replication, or protected-schema privileges.
- Shared-mode RLS is forced and bound to both role mapping and transaction context.
- Connection material is encrypted at rest and represented outside the secret store only by an opaque reference.
- Provider and migration errors fail closed. No mock fallback is permitted outside an explicit test adapter.
- Maintenance, cutover, rollback, and cleanup are audited administrative operations.

## Error handling

- Validation errors return stable 4xx codes without enqueueing work.
- Queue unavailability leaves the desired generation pending and returns a retriable service error; it does not mark the mode active.
- Provider timeouts and recoverable PostgreSQL errors use bounded BullMQ retries with exponential backoff.
- Non-recoverable manifest, privilege, checksum, or policy failures stop before cutover.
- Failure before cutover compensates the target and preserves the source.
- Failure after cutover attempts rollback; a failed rollback raises a critical operational alert and keeps both resource references.
- A worker crash resumes from persisted phase and resource identifiers.

## Testing strategy

### Unit tests

- Plan default and Platform Admin override resolution.
- Clearing an override after plan changes.
- Authorization for read, override, reconcile, and SSE APIs.
- Generation and idempotency behavior.
- State-machine transitions, stale-job rejection, retry, compensation, and rollback.
- Identifier validation and error/secret sanitization.
- Read DTOs never include encrypted connection material.

### PostgreSQL integration tests

Run against a real disposable PostgreSQL instance:

- Two tenants coexist in each of SHARED, SCHEMA, and DATABASE modes.
- Positive reads/writes work for the owning tenant.
- Cross-tenant reads return no rows or permission denied, as appropriate.
- A spoofed `app.tenant_id` cannot bypass the protected role mapping.
- Missing session context and missing `tenant_id` fail closed.
- Schema roles cannot access `public` or another tenant schema.
- Database roles cannot connect to another tenant database.
- Product migrations and manifest validation run in every topology.
- All six directed migrations preserve counts and checksums.
- Failures before and after cutover exercise compensation and rollback.

### Worker and API integration tests

- Adapter-mocked worker tests prove phase persistence and resume behavior.
- Duplicate jobs do not create duplicate roles, schemas, or databases.
- Queue failure, recoverable retry, stale generation, and audit emission are covered.
- SSE requires authentication, stays tenant-scoped, and never emits secrets.
- Plan changes enqueue reconciliation only when there is no override.
- Destructive changes require explicit confirmation and rollback readiness.

## Delivery sequence

1. Expand the data model and backfill plan/tenant desired modes.
2. Add `packages/data-isolation` contracts, security primitives, and PostgreSQL adapter using test-driven integration tests.
3. Add API read/admin commands, authorization, audit, and generation enqueueing.
4. Extract worker orchestration from the current entry point and implement the reconciliation state machine.
5. Add authenticated tenant SSE and Platform/Tenant UI surfaces.
6. Validate all modes and transitions in PostgreSQL, then enable the feature behind an entitlement/feature flag.

Rollout starts disabled. Operators configure the administrative PostgreSQL endpoint and encryption key, run validation, and then enable the feature by plan or tenant. Existing tenants are reconciled in controlled batches; no tenant is marked ready without policy and connectivity validation.

## Dependency boundaries

- **Issue #36** consumes the adapter and connection reference to provision managed servers and inject secrets into deployments.
- **Issue #50** may embed `IsolationManifest` in its declarative environment spec and drive later continuous reconciliation.
- **Issue #51** invokes cleanup/deprovision operations under retention and compliance policy.
- **Issues #62–#70** remain v3.x evolution and do not block the v2.2 PostgreSQL contract.

## Acceptance mapping

| Issue criterion | Design evidence |
| --- | --- |
| Three models coexist | Separate PostgreSQL behavior plus multi-tenant integration matrix |
| RLS active for SHARED | Forced RLS, role mapping, transaction context, negative spoofing tests |
| SCHEMA/DATABASE provisioned and removable | Idempotent adapter lifecycle, resource state, compensation and cleanup |
| Tenant connection used by deployments | Encrypted active connection reference consumed by issue #36 |
| Integrated tests for all models | Real PostgreSQL suite plus all six migration directions |
| Authorization and isolation | Platform-only mutations, tenant-scoped reads/SSE, cross-tenant negative tests |
| Idempotency and recoverable failure | Generation keys, advisory locks, checkpoints, retries, compensation |
| Audit and observability | Named audit events, phase metrics, alerts, sanitized structured logs |


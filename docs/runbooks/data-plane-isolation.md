# Data Plane Isolation Runbook (Issue #49)

This runbook describes configuration, rollout, operational monitoring, alert responses, emergency rollback, and issue #36 handoff procedures for Tenant Data Plane Isolation.

## Overview

Organator Cloud supports three PostgreSQL data plane isolation modes:
- `SHARED`: Multi-tenant shared tables with forced Row-Level Security (RLS) policies.
- `SCHEMA`: Exclusive PostgreSQL schema per tenant in a shared database.
- `DATABASE`: Exclusive PostgreSQL database and credentials per tenant.

Plan defaults:
- `free` → `SHARED`
- `pro` → `SCHEMA`
- `enterprise` → `DATABASE`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_ISOLATION_ENABLED` | `false` | Feature flag. When `false`, microservice deployments skip data plane connection enforcement. |
| `DATA_ISOLATION_ADMIN_URL` | `postgresql://organator:password@localhost:5433/organator_db` | Administrative PostgreSQL connection string with DDL privileges. |
| `DATA_ISOLATION_ROLLBACK_HOURS` | `24` | Retention window (in hours) before source resources are eligible for automatic cleanup. |

## Operations & Commands

### 1. View Tenant Status

Platform Admins and Tenant Owners/Admins can query the isolation status:
```bash
GET /v1/tenants/data-isolation
Authorization: Bearer <token>
```

### 2. Platform Admin Override

Platform Admins can set or clear an explicit isolation override:
```bash
PUT /v1/platform/tenants/<tenantId>/data-isolation
Authorization: Bearer <token>
Content-Type: application/json

{
  "mode": "DATABASE",
  "confirmDestructive": false
}
```
Set `"mode": null` to clear the override and revert to the plan default. Moving toward less isolation (e.g. DATABASE → SCHEMA) requires `"confirmDestructive": true`.

### 3. Reconcile Tenant Infrastructure

Re-trigger generation-based reconciliation for a tenant:
```bash
POST /v1/platform/tenants/<tenantId>/data-isolation/reconcile
Authorization: Bearer <token>
```

## Metrics & Monitoring

The Provisioner Worker exposes Prometheus metrics on `http://localhost:9464/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `organator_data_isolation_reconciliations_total` | Counter | Total reconciliations by `source_mode`, `target_mode`, and `result`. |
| `organator_data_isolation_phase_duration_seconds` | Histogram | Duration of each phase (`PREPARE`, `PROVISION_TARGET`, `APPLY_MIGRATIONS`, `COPY`, `VALIDATE`, `CUTOVER`). |
| `organator_data_isolation_retries_total` | Counter | Number of retry attempts per phase. |
| `organator_data_isolation_compensations_total` | Counter | Number of target resource compensations executed. |

## Emergency Rollback

If a tenant experiences data plane issues after cutover:
1. Verify the current generation and rollback retention window (`DATA_ISOLATION_ROLLBACK_HOURS`, default 24h).
2. Issue a Platform Admin override restoring the previous mode (`mode: "<previous_mode>"`, `confirmDestructive: true`).
3. The BullMQ worker will run the state machine, validate source availability, restore the active connection reference, and compensate the target.

## Issue #36 Handoff

Issue #36 will introduce managed PostgreSQL servers (RDS, VPS instances) and inject connection references directly into microservice product deployments.
This implementation exposes sanitized state and opaque connection reference IDs (`dataPlaneConnectionRef`), providing the exact boundary required by Issue #36.

## Multi-Provider Infrastructure Provisioning (Issue #36)

This runbook also covers the multi-provider infrastructure provisioning flow implemented in Issue #36.

### Drivers

Organator supports dynamic resolution of infrastructure providers:
- `DOCKER`: Generates connection strings for local containers/VPS deployments.
- `AWS`: Generates RDS database URLs and Route53 DNS configurations.
- `TERRAFORM`: Generates configurations corresponding to Terraform state outputs.

### Phase Transitions

The provisioning state machine executes in the following sequence:
1. `DB`: The database is allocated and the encrypted connection URL is stored securely.
2. `NETWORK`: The security groups and network boundaries are established.
3. `DNS`: The custom subdomains and DNS records are mapped.
4. `DONE`: Provisioning completes successfully.

### Emergency Deprovisioning & Troubleshooting

If a tenant's infrastructure needs to be torn down:
1. Dispatch the `deprovision-tenant-infra` BullMQ job for the target `tenantId`.
2. The worker will call the provider's `deprovision` method and reset the tenant's data plane status to `PENDING` (`PREPARE` phase).

## Plan Migration Reconciliation (Issue #92)

When a tenant changes their active plan, the platform automatically determines the resource discrepancy and attempts to gracefully reconcile the differences.

### Reconciliation Rules
The `PlanReconciler` engine calculates a strict set of actions during a plan change:
- `CHANGE_DATA_ISOLATION`: Updates the data plane isolation boundary based on the new plan's default (`DATABASE`, `SCHEMA`, `SHARED`).
- `SCALE_REPLICAS`: Updates the allocated number of database read replicas.
- `ADJUST_BACKUP_RETENTION`: Adjusts the number of days automated backups are stored.

### Redis Quota Cache Invalidation
Billing changes must immediately reflect in rate limits. When a plan change is initiated via the Control Plane API, the `quota_cache:<tenantId>` key in Redis is forcefully deleted, prompting an authoritative DB query on the next request.

## Tenant Lifecycle Management (Issues #50, #51, #90, #91)

Organator Cloud handles complex operational lifecycle actions around tenant environments in a standard, predictable, and auditable format.

### Declarative Infrastructure Spec (Issue #50)
A tenant's ideal infrastructure constraints (VPC identifiers, replica counts, isolation constraints) are bound declaratively within `TenantInfraSpec`. `provisioner-worker` consumes these specifications and converges real-world infrastructure parameters into standard topologies across cloud providers (AWS, VPS, Docker).

### Automated & Manual Backups (Issue #90)
Tenants can trigger manual backups or opt-in to scheduled backup policies. When backups are created, a verified payload checksum (`SHA-256`) is stored inside `TenantBackup`. These snapshots can be targeted for data restoration pipelines.

### Tenant Environment Cloning (Issue #91)
For testing, scaling out environments, or performing localized bug reproductions, platform admins can clone a tenant. The system safely replicates the schema, initial states, and infrastructure specifications into an entirely new, isolated tenant namespace.

### Safe Offboarding & Data Purge (Issue #51)
When a tenant requests account termination (e.g. for GDPR/LGPD compliance), a strict sequence of events executes:
1. `PRE_OFFBOARDING` backup snapshot is immediately captured.
2. The infrastructure driver invokes a hard `deprovision` clearing sensitive boundaries (secrets, connection URIs).
3. The underlying compute layers are scrubbed.
## Tenant Environments & Health Monitoring (Issues #52, #93)

Organator Cloud continuously maps the operational health and lifecycle scope of all data plane implementations.

### Environment Management (Issue #93)
Tenants can operate multiple logically isolated boundaries (`PRODUCTION`, `STAGING`, `SANDBOX`). A `promote-tenant-environment` job allows for the unified, atomic promotion of configuration values (`envVars`) directly from lower-tier environments up into `PRODUCTION`.

### Health Metrics & Prometheus Export (Issue #52)
A scheduled global job periodically fires `collect-tenant-metrics` payloads per active organization. These snapshot events:
1. Probe the `DockerDriver` and underlying connectivity engines.
2. Form a composite state evaluation (`HEALTHY`, `DEGRADED`, `DOWN`).
3. Flush memory, CPU, and topological constraints into `TenantHealth`.
4. Export Prometheus-compatible telemetry uniquely labeled with `tenant_id` and `tenant_slug` for Grafana alerting hooks.

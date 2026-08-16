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

### Downgrade Grace Periods
If a tenant downgrades their plan, the platform grants a **7-day grace period** (`Tenant.graceEndsAt`). During this time, they retain their previous dedicated infrastructure and limits to allow them to extract data or adjust usage.
After 7 days, the `apply-downgrade-reconciliation` job executes and forcefully reverts the infrastructure limits and isolation mode. If the tenant upgrades back to their original plan before the 7 days expire, the grace period is cleared and the scheduled job is safely ignored.

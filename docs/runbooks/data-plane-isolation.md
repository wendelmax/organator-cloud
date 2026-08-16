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

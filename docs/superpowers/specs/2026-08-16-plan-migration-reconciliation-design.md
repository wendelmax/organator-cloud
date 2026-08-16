# Design Spec: Plan Migration & Infrastructure Reconciliation (Issue #92)

**Feature:** Plan Migration with Infrastructure Reconciliation & Grace Period  
**Issue:** #92  
**Status:** Approved  
**Date:** 2026-08-16  

---

## 1. Executive Summary

This document specifies the design for tenant plan migration with automated infrastructure reconciliation in Organator Cloud. Expanding on the Tenant Data Plane Isolation (#49) and Tenant Infrastructure Provisioning (#36) systems, this feature provides declarative spec diffing between billing plans, instant upgrade reconciliation, 7-day downgrade grace periods with dunning notifications, Redis quota cache invalidation, and timeline audit logging.

---

## 2. Declarative Plan Spec Engine (`PlanSpecResolver` & `PlanReconciler`)

### 2.1 Plan Resource Specification (`PlanResourceSpec`)

Each billing plan (`free`, `pro`, `enterprise`) maps to a declarative `PlanResourceSpec`:

```typescript
export interface PlanResourceSpec {
  plan: string;
  isolationMode: 'SHARED' | 'SCHEMA' | 'DATABASE';
  replicas: number;
  backupRetentionDays: number;
  allowCustomDomains: boolean;
  quotas: {
    maxUsers: number;
    maxStorageGb: number;
    maxApiRequestsPerMin: number;
  };
}
```

Plan definitions:
- **Free:** `SHARED` mode, 1 replica, 1 day backup retention, 0 custom domains, 5 max users, 1GB storage, 60 req/min.
- **Pro:** `SCHEMA` mode, 2 replicas, 7 days backup retention, 1 custom domain, 50 max users, 20GB storage, 600 req/min.
- **Enterprise:** `DATABASE` mode, 3 replicas, 30 days backup retention, unlimited custom domains, unlimited users, 500GB storage, 6000 req/min.

### 2.2 Reconciler Diff Actions (`calculatePlanDiff`)

Given `currentSpec` and `targetSpec`, `calculatePlanDiff` produces atomic actions:

```typescript
export type ReconcileAction =
  | { type: 'CHANGE_DATA_ISOLATION'; mode: 'SHARED' | 'SCHEMA' | 'DATABASE' }
  | { type: 'SCALE_REPLICAS'; count: number }
  | { type: 'ADJUST_BACKUP_RETENTION'; retentionDays: number }
  | { type: 'TOGGLE_CUSTOM_DOMAIN'; enabled: boolean };
```

---

## 3. Workflow: Upgrades vs. Downgrades & Grace Period

### 3.1 Upgrades (`free` → `pro`, `pro` → `enterprise`)

1. `TenantsService.changePlan()` updates the tenant's plan in PostgreSQL.
2. Invalidation command sent to Redis: `DEL quota_cache:<tenantId>`.
3. Enqueues job `reconcile-plan-migration` in BullMQ (`provisioner` queue).
4. `provisioner-worker` executes actions sequentially (`CHANGE_DATA_ISOLATION` → `SCALE_REPLICAS` → `ADJUST_BACKUP_RETENTION`).
5. Emits audit log `PLAN_UPGRADE_COMPLETED`.

### 3.2 Downgrades (`enterprise` → `pro`, `pro` → `free`)

1. Immediate Redis cache invalidation (`quota_cache:<tenantId>`) enforcing new quota limits for API requests.
2. Tenant record updated with `graceEndsAt = Date.now() + 7 days` and state `DOWNGRADE_GRACE_PERIOD`.
3. Delayed job `apply-downgrade-reconciliation` enqueued in BullMQ with 7-day delay (`delay: 7 * 24 * 60 * 60 * 1000`).
4. If tenant upgrades back within 7 days, the delayed job is cancelled (`job.remove()`) and infrastructure is preserved.
5. Upon 7-day expiration, the worker executes resource reductions safely.

---

## 4. UI & Audit Timeline (`backoffice-web`)

- **Downgrade Grace Period Banner:** Displays countdown banner in `/settings` and `/tenants` showing remaining grace period days.
- **Timeline Events:** Writes structured audit records: `PLAN_UPGRADE_STARTED`, `PLAN_UPGRADE_COMPLETED`, `DOWNGRADE_GRACE_PERIOD_STARTED`, `DOWNGRADE_RECONCILED`.

# Design Spec: Tenant Environments Management & Health Metrics Suite (Issues #93 & #52)

**Features:** Staging/Sandbox Environments (#93), Health & Usage Metrics Dashboard (#52)  
**Status:** Approved  
**Date:** 2026-08-16  

---

## 1. Executive Summary

This document specifies the design for the final suite of Milestone **v2.2.0 — Provisioner & Providers One-Click**. It establishes environment management (`TenantEnvironment`) for Staging and Sandbox instances with config promotion to Production (#93), and tenant health monitoring (`TenantHealth`) driven by background metric collection (`collect-tenant-metrics`) and Prometheus metrics export labeled with `tenant_id` and `tenant_slug` (#52).

---

## 2. Prisma Data Schema (`TenantEnvironment` & `TenantHealth`)

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

---

## 3. Worker Handlers (`provisioner-worker`)

1. **`collect-tenant-metrics` (Issue #52):**
   - Recurring BullMQ job that evaluates DB, Network, and DNS readiness per tenant, inserts a `TenantHealth` snapshot, and publishes Prometheus gauge metrics labeled with `tenant_id` and `tenant_slug`.
2. **`promote-tenant-environment` (Issue #93):**
   - Atomically promotes environment variables from `STAGING`/`SANDBOX` to `PRODUCTION`.

---

## 4. Control Plane API & UI Integration

### 4.1 Endpoints (`control-plane-api`)
- `GET /v1/platform/tenants/:id/environments` — Lists tenant environments.
- `POST /v1/platform/tenants/:id/environments` — Creates/updates Staging/Sandbox environments.
- `POST /v1/platform/tenants/:id/environments/promote` — Promotes Staging configs to Production.
- `GET /v1/platform/tenants/:id/health` — Returns tenant health status and historical metrics.
- `GET /v1/platform/tenants/health-summary` — Aggregated tenant health summary for observability dashboards.

### 4.2 UI Components (`backoffice-web`)
- **Environments Management:** Interface for configuring Staging/Sandbox variables and promoting to Production.
- **Tenant Health Cards & Gauges:** Visual indicators displaying component statuses (`HEALTHY`, `DEGRADED`, `DOWN`) and resource metrics.

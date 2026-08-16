# Design Spec: Dynamic Tenant Infrastructure Provisioning (Issue #36)

**Feature:** Dynamic Tenant Infrastructure Provisioning  
**Issue:** #36  
**Status:** Approved  
**Date:** 2026-08-16  

---

## 1. Executive Summary

This document specifies the design for dynamic, multi-provider infrastructure provisioning per tenant in Organator Cloud. Building directly upon the Tenant Data Plane Isolation contracts established in Issue #49, this feature provides one-click and automated provisioning of isolated databases, virtual networks, and DNS routing records across Docker (local/VPS), AWS native SDKs, and Terraform / IaC drivers.

---

## 2. Architecture & Pluggable Driver Interface (`@organator/cloud-providers`)

### 2.1 Unified `InfrastructureProvider` Interface

All infrastructure drivers implement a common interface exported by `@organator/cloud-providers`:

```typescript
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

  /** Phase 1: Provision or configure database resources */
  prepareDatabase(spec: ProvisioningSpec): Promise<{ databaseId: string; connectionUrl: string }>;

  /** Phase 2: Provision or configure virtual network isolation */
  prepareNetwork(spec: ProvisioningSpec): Promise<{ networkId: string }>;

  /** Phase 3: Provision or configure DNS record & routing */
  configureDNS(spec: ProvisioningSpec): Promise<{ dnsRecord: string }>;

  /** Deprovisioning: Safely dismantle tenant infrastructure in reverse order */
  deprovision(spec: ProvisioningSpec, state: ResourceState): Promise<void>;
}
```

### 2.2 Driver Implementations

1. **`DockerDriver` (Local Dev & VPS)**
   - **Database:** Provisions a dedicated PostgreSQL container or schema with volume persistence and isolated port/user.
   - **Network:** Creates and connects the tenant container to a virtual Docker network `org_net_<tenant>`.
   - **DNS:** Registers reverse proxy routing rules (NGINX/Traefik).

2. **`AWSDriver` (AWS Native SDK v3)**
   - **Database:** Provisions AWS RDS PostgreSQL instance/cluster via `@aws-sdk/client-rds`.
   - **Network:** Allocates a dedicated Security Group and Subnet Association inside the VPC via `@aws-sdk/client-ec2`.
   - **DNS:** Creates Route53 A/CNAME record `{slug}.organator.io` via `@aws-sdk/client-route53`.

3. **`TerraformDriver` (IaC via OpenTofu/Terraform CLI)**
   - Executes parameterized HCL templates using `terraform apply -auto-approve -json`, parsing output JSON to capture `databaseId`, `connectionUrl`, `networkId`, and `dnsRecord`.

---

## 3. Provisioner Worker State Machine & SSE Tracking (`provisioner-worker`)

### 3.1 Job Flow (`deploy-tenant-infra`)

When a `deploy-tenant-infra` job executes in BullMQ:
1. **Advisory Lock:** Acquires a PostgreSQL advisory lock (`pg_advisory_xact_lock`) for the tenant to enforce idempotency.
2. **Phase Execution & Logging:**
   - **`DB` Phase:** Invokes `driver.prepareDatabase(spec)`. Encrypts the resulting connection URL using AES-256-GCM (`@organator/cloud-providers`) and updates `TenantDataPlane`.
   - **`NETWORK` Phase:** Invokes `driver.prepareNetwork(spec)`.
   - **`DNS` Phase:** Invokes `driver.configureDNS(spec)`.
   - **`DONE` Phase:** Updates `Deployment` status to `SUCCESS` and `TenantDataPlane` status to `READY`.
3. **SSE Event Emission:** Publishes real-time progress events to Redis Pub/Sub channel `deploy_logs:<deploymentId>`, streamed to the frontend via NestJS `@Sse()`.

### 3.2 Deprovisioning Job (`deprovision-tenant-infra`)

Executes resource dismantling in strict reverse order (`DNS` → `NETWORK` → `DB`). On `DATABASE` and `SCHEMA` modes, database deletion enforces the 24-hour retention period before permanent expunge.

---

## 4. Control Plane API & UI Integration

### 4.1 Control Plane API Endpoints

- `POST /v1/platform/tenants/:id/provision-infra` — Triggers/re-triggers tenant infrastructure provisioning.
- `GET /v1/tenants/infra/stream/:deploymentId` — Authenticated SSE stream for real-time phase logs (`DB` → `NETWORK` → `DNS` → `DONE`).

### 4.2 UI Controls (`backoffice-web`)

- **Automatic Onboarding:** Triggered automatically upon new tenant registration.
- **Self-Service & Manual Retry:** One-click "Provisionar / Re-tentar Infraestrutura" button in the Tenant Dashboard with real-time phase stepper visual feedback.

---

## 5. Security & Compliance

- **Secret Redaction:** Plaintext connection strings are encrypted immediately with AES-256-GCM using `ENCRYPTION_KEY` and never stored in plain text or logged.
- **Audit Logging:** Every phase transition, provisioning start, retry, and deprovisioning event writes an audit record to `AuditLog`.
- **Tenant Scope:** Microservices access database credentials only via opaque `dataPlaneConnectionRef` references resolved inside the worker execution context.

# Design Spec: Tenant Lifecycle, Backup, Cloning & Offboarding Suite (Issues #50, #90, #91, #51)

**Features:** Declarative Spec (#50), Backup & Restore (#90), Tenant Environment Cloning (#91), Offboarding & Safe Data Purge (#51)  
**Status:** Approved  
**Date:** 2026-08-16  

---

## 1. Executive Summary

This document specifies the design for the complete Tenant Lifecycle Suite in Organator Cloud. Combining issues #50, #90, #91, and #51 into a unified, production-grade architecture, this specification establishes declarative infrastructure definitions (`TenantInfraSpec`), encrypted backup snapshots and automated retention purging (`TenantBackup`), environment cloning for Sandbox/Staging environments, and LGPD/GDPR-compliant offboarding with ordered infrastructure deprovisioning.

---

## 2. Prisma Data Schema (`TenantInfraSpec` & `TenantBackup`)

```prisma
model TenantInfraSpec {
  id                  String   @id @default(uuid())
  tenantId            String   @unique
  tenant              Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  specVersion         String   @default("v1alpha1")
  databaseConfig      Json     // isolationMode, storageGb, port
  networkConfig       Json     // vpcId, securityGroupId, subnetId
  replicas            Int      @default(1)
  allowCustomDomains  Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}

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

model TenantBackup {
  id              String       @id @default(uuid())
  tenantId        String
  tenant          Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  type            BackupType   @default(MANUAL)
  status          BackupStatus @default(PENDING)
  storagePath     String
  checksum        String?      // SHA-256 hash
  sizeBytes       BigInt?
  retentionDays   Int          @default(7)
  expiresAt       DateTime?
  metadata        Json?
  createdAt       DateTime     @default(now())

  @@index([tenantId, status])
}
```

---

## 3. Worker Job Handlers (`provisioner-worker`)

1. **`backup-tenant-infra` (Issue #90):**
   - Dumps tenant tables, encrypts payload using AES-256-GCM, computes SHA-256 checksum, and writes `TenantBackup` with `expiresAt = Date.now() + retentionDays`.
2. **`restore-tenant-infra` (Issue #90):**
   - Validates SHA-256 checksum and restores tenant database schema and records.
3. **`clone-tenant-environment` (Issue #91):**
   - Creates a new target tenant (e.g. `acme-sandbox`), provisions base infrastructure using `@organator/cloud-providers`, and restores source snapshot.
4. **`offboard-tenant-infra` (Issue #51):**
   - **Phase 1:** Creates a final backup with `PRE_OFFBOARDING` type.
   - **Phase 2:** Revokes API keys, active sessions, and sets state to `OFFBOARDING`.
   - **Phase 3:** Dismantles infrastructure in strict reverse order (`DNS` → `NETWORK` → `DB`).
   - **Phase 4:** Purges personal data and backup snapshots upon expiration of LGPD/GDPR retention period.

---

## 4. Control Plane API & UI Integration

### 4.1 Endpoints (`control-plane-api`)
- `POST /v1/platform/tenants/:id/backups` — Triggers manual backup.
- `GET /v1/platform/tenants/:id/backups` — Lists tenant backups.
- `POST /v1/platform/tenants/:id/restore` — Triggers restore from backup.
- `POST /v1/platform/tenants/:id/clone` — Clones tenant to a new environment.
- `DELETE /v1/platform/tenants/:id/offboard` — Triggers full offboarding.

### 4.2 UI Components (`backoffice-web`)
- **Backups Tab in `/settings`:** List, manual trigger, and restore buttons.
- **Clone Modal in `/tenants`:** Input form for target slug and plan selection.
- **Offboard Confirmation Modal:** Checklist of affected resources and grace period information.

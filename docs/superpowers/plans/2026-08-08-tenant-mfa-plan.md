# Tenant MFA and Secure Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce tenant MFA policy in password/OIDC authentication with secure challenges, recovery codes, lockout, and audit events.

**Architecture:** Additive Prisma models store tenant policy, opaque challenge hashes, and recovery-code hashes. `AuthService` creates/consumes challenges and remains the only issuer of local JWTs; `MfaService` owns TOTP/recovery operations and `AuthController` exposes verification and tenant-admin policy endpoints.

**Tech Stack:** NestJS, Prisma 5, PostgreSQL, bcrypt, otplib, JWT, Jest.

## Global Constraints

- Never persist or log plaintext passwords, TOTP secrets, recovery codes, or challenge tokens.
- Existing MFA-disabled login response remains backward-compatible.
- Tenant policy is enforced server-side for password and OIDC identities.
- Additive migration must be reversible and indexed for challenge/code lookup.

### Task 1: Add additive security schema

**Files:**
- Modify: `packages/core-models/prisma/schema.prisma`
- Create: `packages/core-models/prisma/migrations/<timestamp>_tenant_mfa_security/migration.sql`

- [x] Add `TenantSecurityPolicy`, `MfaChallenge`, and `MfaRecoveryCode` models, user lockout fields, tenant/user relations, expiry and lookup indexes.
- [x] Add migration SQL with defaults and indexes; run `npx prisma generate` and inspect SQL.
- [x] Verify `npm run build --workspace=@organator/core-models`.

### Task 2: Implement policy/challenge primitives with tests

**Files:**
- Create: `apps/control-plane-api/src/auth/mfa-policy.service.ts`
- Modify: `apps/control-plane-api/src/auth/mfa.service.ts`
- Test: `apps/control-plane-api/src/auth/mfa-policy.service.spec.ts`
- Test: `apps/control-plane-api/src/auth/mfa.service.spec.ts`

- [x] Write tests for policy resolution and MFA gating.
- [x] Implement policy defaults, cryptographic token hashing, atomic code consumption, and bounded failure counters.
- [x] Run the focused tests and confirm all pass.

### Task 3: Gate password login and expose verification

**Files:**
- Modify: `apps/control-plane-api/src/auth/auth.service.ts`
- Modify: `apps/control-plane-api/src/auth/auth.controller.ts`
- Modify: `apps/control-plane-api/src/auth/auth.module.ts`
- Test: `apps/control-plane-api/src/auth/auth.service.spec.ts`
- Test: `apps/control-plane-api/src/auth/auth.controller.spec.ts`

- [x] Add tests proving required MFA returns no JWT.
- [x] Implement `POST /v1/auth/mfa/verify` and preserve the non-MFA login response.
- [x] Add recovery-code issuance/re-enrollment endpoint with one-time response.
- [x] Record challenge, success, failure, and recovery audit events without secrets.

### Task 4: Add tenant policy API and OIDC enforcement

**Files:**
- Modify: `apps/control-plane-api/src/auth/auth.controller.ts`
- Modify: `apps/control-plane-api/src/auth/oidc.strategy.ts`
- Test: `apps/control-plane-api/src/auth/oidc.strategy.spec.ts`
- Test: `apps/control-plane-api/src/auth/auth.controller.spec.ts`

- [x] Add owner/admin-only policy GET/PUT endpoints scoped to `req.user.tenantId`.
- [x] Reject invalid modes/roles and cross-tenant writes.
- [x] Ensure OIDC identities cannot bypass required tenant MFA.

### Task 5: Full verification and handoff

- [x] Run API unit tests, E2E tests, API build, schema validation, lint, and audit checks available in this environment.
- [x] Update the issue/PR with migration, rollout, rollback, and no-external-event decisions.
- [ ] Commit, push, open PR, and wait for CI before recommending merge.

# Milestone 5 Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and close every remaining acceptance criterion in milestone 5 without weakening tenant isolation or token security.

**Architecture:** Extend the existing NestJS tenant-scoped APIs and Next.js backoffice rather than introducing parallel flows. Each issue is completed with focused service tests, UI behavior, audit events, and compatibility with legacy routes and data.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js 16, NextAuth, Stripe, Jest, BullMQ.

## Global Constraints

- Keep raw API/invitation/session tokens out of persistence and URLs.
- Enforce tenant isolation in API services, not only in UI.
- Keep `User.tenantId` compatibility while `TenantMembership` rolls out.
- Run Prisma generation, unit tests, and Turbo build before completion.

---

### Task 1: Complete API key management (#87)

**Files:**
- Modify: `apps/backoffice-web/src/app/(dashboard)/api-keys/page.tsx`
- Modify: `apps/control-plane-api/src/api-keys/api-keys.controller.ts`
- Test: `apps/control-plane-api/src/api-keys/api-keys.service.spec.ts`

- [ ] Add edit name/scopes/expiry UI backed by `PATCH /v1/api-keys/:id`.
- [ ] Add regeneration as create-new-then-confirm-revoke-old, showing the new token once.
- [ ] Display last use, expiry, expired state, creator, and scope badges.
- [ ] Restrict management roles to `PLATFORM_ADMIN` and `OWNER`.
- [ ] Run API key tests and build, then commit.

### Task 2: Complete invitation lifecycle (#88)

**Files:**
- Modify: `packages/core-models/prisma/schema.prisma`
- Create: `packages/core-models/prisma/migrations/20260815040000_invitation_lifecycle/migration.sql`
- Modify: `apps/control-plane-api/src/tenants/invitations.service.ts`
- Modify: `apps/control-plane-api/src/tenants/invitations.controller.ts`
- Create: `apps/control-plane-api/src/tenants/invitations.service.spec.ts`
- Modify: `apps/backoffice-web/src/app/(dashboard)/settings/page.tsx`

- [ ] Add explicit `revokedAt` and delivery tracking fields with indexes.
- [ ] Add tenant-scoped revoke and resend endpoints with token rotation and audit events.
- [ ] Reject accepted, revoked, and expired tokens consistently.
- [ ] Add pending/accepted/revoked invitation table and resend/revoke UI.
- [ ] Run invitation tests and build, then commit.

### Task 3: Complete session policies (#89)

**Files:**
- Modify: `apps/control-plane-api/src/auth/auth.service.ts`
- Modify: `apps/control-plane-api/src/auth/auth.controller.ts`
- Create: `apps/control-plane-api/src/auth/session.service.spec.ts`
- Modify: `apps/backoffice-web/src/app/(dashboard)/sessions/page.tsx`

- [ ] Enforce `MAX_ACTIVE_SESSIONS_PER_USER` and evict the oldest active session.
- [ ] Add `DELETE /v1/auth/sessions/:id` and revoke-all-except-current.
- [ ] Revoke other sessions after password change and MFA enable.
- [ ] Audit selective and bulk revocation.
- [ ] Add revoke-all UI and run tests/build, then commit.

### Task 4: Complete billing self-service (#47)

**Files:**
- Modify: `apps/control-plane-api/src/billing/billing.service.ts`
- Modify: `apps/control-plane-api/src/billing/billing.controller.ts`
- Modify: `apps/control-plane-api/src/onboarding/onboarding.controller.ts`
- Modify: `apps/backoffice-web/src/app/(dashboard)/billing/page.tsx`
- Test: `apps/control-plane-api/src/billing/billing.service.spec.ts`

- [ ] Authenticate every tenant billing request and remove fallback tenant behavior.
- [ ] Return plan price, currency, renewal/trial metadata, quotas, usage, and limit types.
- [ ] Add upgrade modal that creates checkout for the selected target plan.
- [ ] Open Stripe Portal in an in-app modal/new isolated window with same-page return.
- [ ] Show hard-limit CTA, soft-limit warning, past-due banner, and suspended paywall.
- [ ] Run billing tests/build, then commit.

### Task 5: Complete organization context routes (#48)

**Files:**
- Create: `apps/backoffice-web/src/app/(dashboard)/org/[slug]/layout.tsx`
- Create: `apps/backoffice-web/src/app/(dashboard)/org/[slug]/settings/page.tsx`
- Create: `apps/backoffice-web/src/app/(dashboard)/org/[slug]/billing/page.tsx`
- Create: `apps/backoffice-web/src/app/(dashboard)/org/[slug]/services/page.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/layout.tsx`
- Modify: `apps/backoffice-web/src/app/(dashboard)/settings/page.tsx`

- [ ] Resolve and authorize slug using `GET /v1/tenants/context/:slug`.
- [ ] Preserve slug in navigation and redirect legacy pages to the active organization.
- [ ] Add searchable context switcher and create-organization action.
- [ ] Embed organization profile, members/invitations, billing, and permissions links.
- [ ] Run backoffice build and end-to-end route checks, then commit.

### Task 6: Verify and close milestone

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-close-milestone-5.md`

- [ ] Run Prisma generate, unit tests, `npx turbo build`, and `git diff --check`.
- [ ] Open one milestone-completion PR referencing #47, #48, #87, #88, and #89.
- [ ] Wait for green CI and merge confirmation.
- [ ] Close the five issues with links to the merged PRs and verify milestone 5 has zero open issues.

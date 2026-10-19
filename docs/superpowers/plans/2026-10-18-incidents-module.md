# Incidents Module (#110) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete incident management module (API + backoffice UI) for issue #110 — create/assign incidents, timeline with internal notes, and affected-tenant blast radius, all PLATFORM_ADMIN-only and audited.

**Architecture:** A new NestJS module `incidents` in `control-plane-api` following the `billing` module pattern (module/service/controller + co-located specs, `JwtAuthGuard` + `RolesGuard`, `AuditService.record()` on every mutation). The backoffice gets a `/incidentes` list page and `/incidentes/[id]` detail page following existing dashboard patterns (client fetch for reads, server actions for mutations). Data layer already exists: Prisma models `Incident`/`IncidentUpdate`/`IncidentTenant` and migration `20261007000000_incidents`.

**Tech Stack:** NestJS 11, Prisma 5, class-validator DTOs, Jest (API), Next.js 15 + `node:test` (backoffice), Tailwind + `@organator/ui`.

**Spec:** `docs/superpowers/specs/2026-10-18-incidents-module-design.md`

## Global Constraints

- All 7 incident endpoints require `@Roles('PLATFORM_ADMIN')` with `@UseGuards(JwtAuthGuard, RolesGuard)` at class level — the API is the authorization boundary (spec §Seção 1).
- Every mutation calls `AuditService.record()` with actions: `incident.create`, `incident.update`, `incident.update.add`, `incident.affected.add`, `incident.affected.remove` — best-effort, never throws (spec §Seção 1).
- Creating an incident whose `alertKey` matches an **open** (non-resolved) incident returns the existing incident (idempotent 200, never 409). Resolving clears `alertKey` (spec §Seção 1).
- Setting `status = resolved` fills `resolvedAt`; re-opening (resolved → any other status) clears `resolvedAt` (spec §Seção 1).
- `IncidentUpdate.authorEmail` comes from the JWT user (`req.user.email`), never from the request body (spec §Seção 1).
- No new public routes; no tenant-facing reads; no notifications/emails (spec §Intenção).
- No external integrations (no webhooks/events) — record in PR description (spec §Intenção).
- Comments and identifiers in PT-BR like surrounding code; error strings PT-BR matching existing pages ("Sessão expirada. Entre novamente.").
- Test commands: API `npm test -- <pattern>` in `apps/control-plane-api`; web `npm test` in `apps/backoffice-web`.

## Review Focus

1. **alertKey dedup returns open incident, but a resolved incident with the same key must not block a new one** — most likely to bite when alerts arrive later. Test in Task 1: `dedup: creating with an alertKey of a resolved incident creates a new incident`.
2. **Re-open clears `resolvedAt` and restores dedup eligibility** — an operator reopening a resolved incident expects the timeline to reflect "active again". Test in Task 1: `reopening a resolved incident clears resolvedAt and alertKey`.
3. **Internal notes must be flagged (`internal: true`) and persisted as such** — future status page filters on this flag; a lost flag leaks internal notes. Test in Task 1: `addUpdate persists internal=true notes with authorEmail`.
4. **SUPPORT role (read-only platform staff) must get 403 on every incident mutation** — SUPPORT exists in the codebase and is not in the allow-list. Test in Task 2: controller roles metadata excludes `SUPPORT`, plus guard metadata test.
5. **Web mutating actions refuse without a session token and surface API errors** — the UI must never silently swallow a 403/404. Test in Task 3: `every mutating incident action refuses to run without a session token` and an API-error propagation test.

---

### Task 1: IncidentsService

**Files:**
- Create: `apps/control-plane-api/src/incidents/incidents.service.ts`
- Test: `apps/control-plane-api/src/incidents/incidents.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (from `../prisma/prisma.service`), `AuditService.record(entry)` (from `../audit/audit.service`).
- Produces (Task 2 uses these exact signatures):
  - `list(filters: { status?: string; severity?: string; component?: string; page?: number; limit?: number }): Promise<{ items: Incident[]; total: number; page: number; pages: number }>`
  - `create(input: CreateIncidentInput, actor: { userId: string; email?: string }): Promise<Incident>` — dedup by `alertKey`
  - `get(id: string): Promise<Incident & { updates: IncidentUpdate[]; affected: IncidentTenant[] }>` — throws `NotFoundException`
  - `update(id: string, input: UpdateIncidentInput, actor: { userId: string; email?: string }): Promise<Incident>` — handles `resolvedAt` fill/clear
  - `addUpdate(id: string, input: { status: string; message: string; internal?: boolean }, authorEmail?: string): Promise<IncidentUpdate>` — throws `NotFoundException` if incident missing
  - `addAffected(id: string, tenantId: string): Promise<void>` — throws `NotFoundException` if tenant or incident missing; idempotent if already linked
  - `removeAffected(id: string, tenantId: string): Promise<void>` — throws `NotFoundException` if link missing
  - Types `CreateIncidentInput` (`title`, `severity?`, `status?`, `component?`, `public?`, `assigneeEmail?`, `source?`, `alertKey?`, `postmortemUrl?`) and `UpdateIncidentInput` (all optional)

- [ ] **Step 1: Write the failing service spec**

Create `incidents.service.spec.ts` with a hand-rolled in-memory prisma mock in the style of `billing/dunning.service.spec.ts` (Maps for `incident`, `incidentUpdate`, `incidentTenant`, `tenant`; `audit: { record: jest.fn() }`). Test cases:

```ts
describe('IncidentsService (#110)', () => {
  it('create stores a manual incident with defaults (severity=minor, status=investigating, public=true) and audits incident.create')
  it('dedup: creating with an alertKey of an OPEN incident returns the existing incident without creating another')
  it('dedup: creating with an alertKey of a RESOLVED incident creates a new incident')
  it('update to status=resolved fills resolvedAt, clears alertKey, and audits incident.update')
  it('reopening a resolved incident clears resolvedAt')
  it('addUpdate persists internal=true notes with authorEmail passed by the controller')
  it('addUpdate audits incident.update.add')
  it('addAffected throws NotFoundException for an unknown tenant and is idempotent for a linked one')
  it('removeAffected throws NotFoundException when the tenant is not linked')
  it('get throws NotFoundException for an unknown id')
  it('list filters by status and paginates')
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- incidents.service.spec.ts` (cwd `apps/control-plane-api`)
Expected: FAIL — module not found `./incidents.service`

- [ ] **Step 3: Implement `IncidentsService` in `incidents.service.ts`**

`@Injectable()` class injecting `PrismaService` and `AuditService`. Approach notes: dedup = when `input.alertKey` is set, `findFirst` where `alertKey = input.alertKey AND status != 'resolved'` and return it untouched (no audit); `create` always sets `startedAt: new Date()` default from schema. `update` composes `data.resolvedAt` (set `new Date()` when arriving at `resolved`, `null` when leaving it) and `alertKey: null` when resolving. Each audit call: `{ actorId: actor.userId, actorEmail: actor.email, action, resourceType: 'incident', resourceId: id, changes }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- incidents.service.spec.ts` (cwd `apps/control-plane-api`)
Expected: PASS, all cases green

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane-api/src/incidents/
git commit -m "feat(incidents): service with alertKey dedup, timeline and blast radius (#110)"
```

---

### Task 2: IncidentsController, DTOs and module wiring

**Files:**
- Create: `apps/control-plane-api/src/incidents/incidents.controller.ts`
- Create: `apps/control-plane-api/src/incidents/incidents.module.ts`
- Create: `apps/control-plane-api/src/incidents/dto/incident.dto.ts` (3 DTOs: `CreateIncidentDto`, `UpdateIncidentDto`, `AddUpdateDto`)
- Modify: `apps/control-plane-api/src/app.module.ts` (import + register `IncidentsModule`)
- Test: `apps/control-plane-api/src/incidents/incidents.controller.spec.ts`

**Interfaces:**
- Consumes: `IncidentsService` from Task 1 (exact signatures above), `JwtAuthGuard`, `RolesGuard`, `Roles` from `../auth/*`.
- Produces (Task 4/5 consume via HTTP):
  - `GET /v1/incidents?status=&severity=&component=&page=&limit=` → `{ items, total, page, pages }`
  - `POST /v1/incidents` body `CreateIncidentDto` → incident (or dedup hit)
  - `GET /v1/incidents/:id` → incident + `updates[]` + `affected[]`
  - `PATCH /v1/incidents/:id` body `UpdateIncidentDto` → incident
  - `POST /v1/incidents/:id/updates` body `AddUpdateDto` → `IncidentUpdate`
  - `POST /v1/incidents/:id/affected` body `{ tenantId: string }` → `{ linked: true }`
  - `DELETE /v1/incidents/:id/affected/:tenantId` → `{ removed: true }`

- [ ] **Step 1: Write the failing controller spec**

Create `incidents.controller.spec.ts` in the style of `common/admin-controllers.spec.ts` (direct instantiation with a jest-mock service, `Reflect.getMetadata`):

```ts
describe('IncidentsController (#110)', () => {
  it('is restricted to PLATFORM_ADMIN with JwtAuthGuard + RolesGuard', () => {
    // GUARDS_METADATA === [JwtAuthGuard, RolesGuard]
    // ROLES_KEY === ['PLATFORM_ADMIN']  — SUPPORT must NOT be included
  });
  it('passes the JWT actor (userId/email) to service.create and never trusts body authorEmail')
  it('takes authorEmail for updates from req.user.email only')
  it('maps POST /affected tenantId from body to service.addAffected(id, tenantId)')
  it('propagates NotFoundException from the service untouched')
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- incidents.controller.spec.ts` (cwd `apps/control-plane-api`)
Expected: FAIL — module not found `./incidents.controller`

- [ ] **Step 3: Implement DTOs, controller, module**

DTOs with class-validator: `CreateIncidentDto` (`@IsNotEmpty() title`, `@IsIn(['critical','major','minor']) severity?`, `@IsIn(['investigating','identified','monitoring','resolved']) status?`, `@IsIn(['api','dashboard','provisioning','billing','data-plane']) component?`, `@IsBoolean() public?`, `@IsEmail() assigneeEmail?`, `@IsOptional() @IsString() source?/alertKey?/postmortemUrl?` — all optional fields `@IsOptional()`); `UpdateIncidentDto` = same fields all optional; `AddUpdateDto` (`status @IsIn(...)`, `message @IsNotEmpty @MaxLength(2000)`, `internal @IsBoolean @IsOptional`).

Controller: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Controller('v1/incidents')`, each method `@Roles('PLATFORM_ADMIN')`, building `actor = { userId: req.user.userId, email: req.user.email }` from `@Req() req: any`. Module: `@Module({ imports: [PrismaModule, AuditModule], controllers: [IncidentsController], providers: [IncidentsService] })`. Register `IncidentsModule` in `app.module.ts` alongside the other imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- incidents.controller.spec.ts` (cwd `apps/control-plane-api`)
Expected: PASS

- [ ] **Step 5: Run full API suite + build**

Run: `npm test` (cwd `apps/control-plane-api`) and `npm run build` (cwd `packages/core-models` after `npm run generate`, then `npx nest build` in `apps/control-plane-api`)
Expected: full suite PASS, build clean (regenerating the Prisma client picks up the Incident models if not already generated)

- [ ] **Step 6: Commit**

```bash
git add apps/control-plane-api/src/incidents/ apps/control-plane-api/src/app.module.ts
git commit -m "feat(incidents): PLATFORM_ADMIN API with audit trail (#110)"
```

---

### Task 3: Backoffice server actions

**Files:**
- Create: `apps/backoffice-web/src/app/(dashboard)/incidentes/actions.ts`
- Test: `apps/backoffice-web/src/app/server-actions.test.ts` (extend existing file — it already mocks `next-auth`/`next/cache` and `fetch`)

**Interfaces:**
- Consumes: HTTP endpoints from Task 2; existing `serverApiUrl()`, `apiErrorMessage()`, `getServerSession(authOptions)`, `revalidatePath()` — same imports as `(dashboard)/services/actions.ts`.
- Produces (Tasks 4/5 render these):
  - `createIncident(formData: FormData): Promise<ActionResult>` — POST `/v1/incidents`, revalidates `/incidentes`
  - `resolveIncident(id: string): Promise<ActionResult>` — PATCH `/v1/incidents/:id` `{ status: 'resolved' }`, revalidates `/incidentes` and `/incidentes/${id}`
  - `updateIncident(id: string, patch: Record<string, unknown>): Promise<ActionResult>` — PATCH, revalidates detail
  - `addIncidentUpdate(id: string, formData: FormData): Promise<ActionResult>` — POST `.../updates` with `{ status, message, internal }`, revalidates detail
  - `addAffectedTenant(id: string, tenantId: string): Promise<ActionResult>` and `removeAffectedTenant(id: string, tenantId: string): PromiseActionResult` — revalidate detail
  - All return `ActionResult` (`{ success: true } | { success: false; error: string }`); no-session returns `"Sessão expirada. Entre novamente."`

- [ ] **Step 1: Write the failing action tests**

Append to `server-actions.test.ts`: import `incidentes = await import('./(dashboard)/incidentes/actions')` in `before()`. Test cases:

```ts
describe('incident actions', () => {
  test('every mutating incident action refuses to run without a session token', ...)  // currentSession = null; all 6 actions → { success: false, error: 'Sessão expirada. Entre novamente.' }; assert fetch never called
  test('createIncident posts the form fields and revalidates /incidentes', ...)       // assert lastCall url/method/body + revalidated includes '/incidentes'
  test('resolveIncident PATCHes status=resolved', ...)
  test('addIncidentUpdate converts the internal checkbox to a boolean', ...)           // FormData 'internal' = 'on' → body.internal === true; absent → false
  test('API error surfaces via apiErrorMessage (e.g. 404)', ...)                       // mockFetch(404) → success:false with non-empty error
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (cwd `apps/backoffice-web`)
Expected: FAIL — cannot import `./(dashboard)/incidentes/actions`

- [ ] **Step 3: Implement `actions.ts`**

Mirror `(dashboard)/services/actions.ts` line-for-line in structure: `getServerSession` → token guard → `fetch` with `Authorization: Bearer` → `apiErrorMessage` on `!res.ok` → `revalidatePath`. Read `formData.get(...)` values; boolean fields default `false` when absent.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (cwd `apps/backoffice-web`)
Expected: PASS (existing + new cases)

- [ ] **Step 5: Commit**

```bash
git add "apps/backoffice-web/src/app/(dashboard)/incidentes/actions.ts" apps/backoffice-web/src/app/server-actions.test.ts
git commit -m "feat(web): incident server actions (#110)"
```

---

### Task 4: Incident list page + navigation

**Files:**
- Create: `apps/backoffice-web/src/app/(dashboard)/incidentes/page.tsx` (client component, single file — pattern: `(dashboard)/audit/page.tsx`)
- Modify: `apps/backoffice-web/src/app/(dashboard)/layout.tsx` (nav link inside the existing `isPlatformStaff` block, next to "Audit Log")

**Interfaces:**
- Consumes: `GET /v1/incidents` (Task 2) via `fetch` with `useSession` token; `publicApiUrl()` from `../../../lib/public-env`; `createIncident` (Task 3); `Button, Card, CardHeader, CardTitle, CardContent, Input` from `@organator/ui`.
- Produces: route `/incidentes` listing rows linking to `/incidentes/{id}`; nav item "Incidentes" visible only when `isPlatformStaff`.

- [ ] **Step 1: Implement the list page**

Client component following `audit/page.tsx`: `useState` for `items`/`loading`/`error`/filters (`status`, `severity`, `component` — sent as query params like audit does), `useCallback load()` fetching `${API_URL}/v1/incidents?${params}`, severity badges (critical → `text-red-400 border-red-500`, major → `text-orange-400 border-orange-500`, minor → `text-neutral-400`), open-incident banner above the table (`items.filter(i => i.status !== 'resolved').length` with a warning style when > 0), and a "Novo incidente" form (título, severidade select, componente select, público checkbox, responsável) calling `createIncident(formData)`. Rows are `Link` to `/incidentes/${id}` showing contagem de updates.

- [ ] **Step 2: Add the nav link**

In `layout.tsx` inside the `isPlatformStaff ? (<> ... </>)` block, after the "Audit Log" link: `<Link href="/incidentes" className="px-4 py-2 rounded-md hover:bg-neutral-800 transition text-rose-400">Incidentes</Link>`.

- [ ] **Step 3: Verify with lint and test**

Run: `npm run lint` and `npm test` (cwd `apps/backoffice-web`)
Expected: both PASS

- [ ] **Step 4: Commit**

```bash
git add "apps/backoffice-web/src/app/(dashboard)/incidentes/page.tsx" "apps/backoffice-web/src/app/(dashboard)/layout.tsx"
git commit -m "feat(web): incident list page and nav (#110)"
```

---

### Task 5: Incident detail page (header, timeline, blast radius)

**Files:**
- Create: `apps/backoffice-web/src/app/(dashboard)/incidentes/[id]/page.tsx` (thin server wrapper, pattern: `services/[id]/page.tsx`)
- Create: `apps/backoffice-web/src/app/(dashboard)/incidentes/[id]/ClientPage.tsx` (client detail UI)

**Interfaces:**
- Consumes: `GET /v1/incidents/:id` (Task 2); `updateIncident`, `resolveIncident`, `addIncidentUpdate`, `addAffectedTenant`, `removeAffectedTenant` (Task 3); tenant search `GET /v1/tenants?` already available with the admin token for the affected-tenant picker.
- Produces: route `/incidentes/[id]` — final deliverable of the plan.

- [ ] **Step 1: Implement `ClientPage.tsx`**

Sections per spec §Seção 2:
- **Header**: título + badges (severidade/status/componente), toggle público, responsável editável, `postmortemUrl` editável → `updateIncident(id, patch)`; "Resolver" button → `resolveIncident(id)` (disable + show `resolvedAt` when `status === 'resolved'`).
- **Timeline**: `updates` sorted `createdAt` asc; public updates highlighted (`border-l-blue-500`), `internal` items muted with an explicit "nota interna" label; form (status select, message textarea, internal checkbox) → `addIncidentUpdate(id, formData)`; each item shows `authorEmail ?? 'sistema'` + `createdAt` formatted `pt-BR`.
- **Blast radius**: chips from `affected[]` with remove button → `removeAffectedTenant`; picker: text input filtering the `GET /v1/tenants` results client-side (name/email contains), click → `addAffectedTenant`.
- **Metadados**: `source`, `alertKey` (read-only), `startedAt`/`resolvedAt`.

- [ ] **Step 2: Implement `page.tsx` wrapper**

`export default async function` receiving `params: { id: string }`, rendering `<ClientPage id={id} />` — same shape as `services/[id]/page.tsx`.

- [ ] **Step 3: Verify lint + tests**

Run: `npm run lint` and `npm test` (cwd `apps/backoffice-web`), then `npm test` (cwd `apps/control-plane-api`)
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add "apps/backoffice-web/src/app/(dashboard)/incidentes/"
git commit -m "feat(web): incident detail with timeline and blast radius (#110)"
```

---

### Task 6: Migration application + final verification

**Files:**
- None created; verifies `packages/core-models/prisma/migrations/20261007000000_incidents/migration.sql` applies cleanly.

**Interfaces:**
- Consumes: DATABASE_URL from the local environment; `npm run migrate:deploy -w @organator/core-models`.
- Produces: confirmed migration state and green monorepo gate.

- [ ] **Step 1: Apply the migration**

Run: `npm run migrate:deploy -w @organator/core-models`
Expected: `20261007000000_incidents` applies without error (tables `Incident`, `IncidentUpdate`, `IncidentTenant` created).

- [ ] **Step 2: Regenerate Prisma client**

Run: `npm run generate -w @organator/core-models`
Expected: `Incident` types available to `packages/core-models` build.

- [ ] **Step 3: Full monorepo gate**

Run: `npm run build` then `npm test` (cwd repo root)
Expected: turbo build + test PASS across workspaces.

- [ ] **Step 4: Commit any generated diffs**

```bash
git add -A
git commit -m "chore(incidents): apply migration and regenerate client (#110)"
```

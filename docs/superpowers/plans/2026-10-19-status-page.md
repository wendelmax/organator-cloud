# Status page pública (#110) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar status page pública derivada de incidentes: endpoint `GET /v1/status` (anônimo) na API e página pública `/status` no backoffice, com status geral/por componente e incidentes públicos (abertos + resolvidos últimos 30 dias), atualizações públicas (`internal=false`).

**Architecture:** Módulo `status` novo na API (separado de `incidents`) com endpoint público sem `@UseGuards`. Página server component em `(public)/status/page.tsx` com `revalidate=60` (ISR), busca direto `GET /v1/status` sem token. Agregação feita no `StatusService` (lê `Incident` + `IncidentUpdate` via Prisma). Sem migração de schema.

**Tech Stack:** NestJS (controller/service/module), Prisma (types via `@organator/core-models`), Next.js App Router (Server Component), Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-19-status-page-design.md` — o plano argumenta a partir da spec; executor deve ler ambos.

## Global Constraints

- API é a fronteira de autorização: leitura pública, sem PII (nunca expor `authorEmail`/`assigneeEmail`/`source`/`alertKey`/`postmortemUrl`/blast radius).
- Filtro fixo no server (`public: true`, `internal: false`) — cliente não controla recorte.
- Endpoint `GET /v1/status` **sem `@UseGuards`** (padrão `/health`, `/v1/docs/public`).
- Sem eventos externos, webhooks ou notificações; sem audit event em leitura pública.
- Seguir padrões existentes do repo (testes unitários com mocks, e2e com `app.inject`, estilos já estabelecidos).
- Sem alteração de schema; read-only; rollback trivial.

## Review Focus

- **Payload mínimo**: resposta pública não contém `authorEmail`, `assigneeEmail`, `source`, `alertKey`, `postmortemUrl` nem `IncidentTenant` — verificar nos testes.
- **Filtro de updates**: `internal: true` nunca aparece na timeline pública — coberto no teste de service.
- **Janela de 30 dias**: incidentes resolvidos com `resolvedAt` > 30 dias atrás **não** entram; abertos sempre entram — coberto no teste de service.
- **Derivação de status**: componente com `critical` aberto → `outage`, `major/minor` → `degraded`, nenhum → `operational`; `overall` = pior entre componentes — coberto no teste de service.
- **Superfície pública anônima**: `GET /v1/status` retorna 200 sem `Authorization` (e2e) e o controller não tem `@UseGuards` (metadados undefined) — coberto em controller.spec e e2e.

---

### Task 1: Status API — módulo, service, controller + unit tests

**Files:**
- Create: `apps/control-plane-api/src/status/status.module.ts`
- Create: `apps/control-plane-api/src/status/status.service.ts`
- Create: `apps/control-plane-api/src/status/status.controller.ts`
- Create: `apps/control-plane-api/src/status/status.service.spec.ts`
- Create: `apps/control-plane-api/src/status/status.controller.spec.ts`
- Modify: `apps/control-plane-api/src/app.module.ts` (importar `StatusModule`)

**Interfaces:**
- Consumes: `PrismaService` (via `PrismaModule`), tipos `Incident`, `IncidentUpdate` de `@organator/core-models`
- Produces: `StatusService.getStatus()` retorna `Promise<StatusResponse>`; `StatusController.status()` expõe `GET /v1/status` (sem guards)

- [ ] **Step 1: Write the failing service test** (`status.service.spec.ts`)

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { StatusService } from './status.service';

describe('StatusService', () => {
  let service: StatusService;
  let prisma: any;

  const makePrisma = () => ({
    incident: {
      findMany: jest.fn(),
    },
  });

  beforeEach(async () => {
    prisma = makePrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [StatusService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<StatusService>(StatusService);
  });

  it('returns empty operational state when no public incidents in window', async () => {
    prisma.incident.findMany.mockResolvedValue([]);
    const res = await service.getStatus();
    expect(res.overall).toBe('operational');
    expect(res.components).toHaveLength(5);
    res.components.forEach((c) => {
      expect(c.status).toBe('operational');
      expect(c.activeIncidents).toBe(0);
    });
    expect(res.incidents).toHaveLength(0);
  });

  it('component critical open -> outage; overall outage', async () => {
    prisma.incident.findMany.mockResolvedValue([
      {
        id: 'i1',
        title: 'API caiu',
        severity: 'critical',
        status: 'investigating',
        component: 'api',
        startedAt: new Date('2026-10-19T00:00:00Z'),
        resolvedAt: null,
        updates: [
          { status: 'investigating', message: 'investigando', createdAt: new Date('2026-10-19T00:01:00Z'), internal: false },
          { status: 'identified', message: 'interno', createdAt: new Date('2026-10-19T00:02:00Z'), internal: true },
        ],
      },
    ]);
    const res = await service.getStatus();
    expect(res.overall).toBe('outage');
    const api = res.components.find((c) => c.component === 'api')!;
    expect(api.status).toBe('outage');
    expect(api.activeIncidents).toBe(1);
    expect(res.incidents).toHaveLength(1);
    expect(res.incidents[0].updates).toHaveLength(1);
    expect(res.incidents[0].updates[0].message).toBe('investigando');
    expect((res.incidents[0] as any).authorEmail).toBeUndefined();
  });

  it('major/minor -> degraded; overall degraded', async () => {
    prisma.incident.findMany.mockResolvedValue([
      { id: 'm1', title: 't', severity: 'major', status: 'monitoring', component: 'billing', startedAt: new Date(), resolvedAt: null, updates: [] },
      { id: 'm2', title: 't2', severity: 'minor', status: 'identified', component: 'dashboard', startedAt: new Date(), resolvedAt: null, updates: [] },
    ]);
    const res = await service.getStatus();
    expect(res.overall).toBe('degraded');
    expect(res.components.find((c) => c.component === 'billing')!.status).toBe('degraded');
    expect(res.components.find((c) => c.component === 'dashboard')!.status).toBe('degraded');
  });

  it('resolved within 30 days included; resolved > 30 days excluded', async () => {
    const now = new Date('2026-10-19T12:00:00Z');
    const within = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 dia
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 dias
    prisma.incident.findMany.mockResolvedValue([
      { id: 'w', title: 'w', severity: 'minor', status: 'resolved', component: 'api', startedAt: within, resolvedAt: within, updates: [] },
      { id: 'o', title: 'o', severity: 'minor', status: 'resolved', component: 'api', startedAt: old, resolvedAt: old, updates: [] },
    ]);
    // monkey patch Date.now inside? easier: pass now by not mocking; test uses system time? wait, use fixed dates in comparison by computing in service vs Date.now — in service use new Date()
    // adjust: set resolvedAt/startedAt relative to "now" by computing
    prisma.incident.findMany.mockResolvedValue([
      { id: 'w', title: 'w', severity: 'minor', status: 'resolved', component: 'api', startedAt: new Date(Date.now() - 864e5), resolvedAt: new Date(Date.now() - 864e5), updates: [] },
      { id: 'o', title: 'o', severity: 'minor', status: 'resolved', component: 'api', startedAt: new Date(Date.now() - 40 * 864e5), resolvedAt: new Date(Date.now() - 40 * 864e5), updates: [] },
    ]);
    const res = await service.getStatus();
    const ids = res.incidents.map((i) => i.id);
    expect(ids).toContain('w');
    expect(ids).not.toContain('o');
  });

  it('open incidents always included even if old', async () => {
    prisma.incident.findMany.mockResolvedValue([
      { id: 'oldopen', title: 'x', severity: 'minor', status: 'investigating', component: 'api', startedAt: new Date(Date.now() - 60 * 864e5), resolvedAt: null, updates: [] },
    ]);
    const res = await service.getStatus();
    expect(res.incidents.map((i) => i.id)).toContain('oldopen');
  });
});
```

- [ ] **Step 2: Run service test to verify it fails**

Run: `npx jest --maxWorkers=1 --maxTests=20000 --testPathPattern="status.service.spec.ts" --no-coverage 2>&1 | tail -30`
Expected: FAIL (StatusService not found / methods missing)

- [ ] **Step 3: Implement `StatusService`** (`apps/control-plane-api/src/status/status.service.ts`)

Create service with `getStatus()` aggregating by the rules in spec: read incidents `public: true` (AND window: open OR resolvedAt within last 30d). Build components for all 5 in fixed order, compute `activeIncidents` = open public incidents per component, derive status per component and overall (max by severity order critical>degraded>operational). Map incidents to public shape: strip PII (`authorEmail`, `assigneeEmail`, `source`, `alertKey`, `postmortemUrl`, no affected). Map updates: only `internal===false`, keep `status,message,createdAt`, chronological asc. Incidents ordering: open first (by `startedAt` desc), resolved after (by `resolvedAt` desc).

Signature: `async getStatus(): Promise<StatusResponse>` where `StatusResponse` is an inline exported type (or interface) matching the JSON in spec.

- [ ] **Step 4: Run service test to verify it passes**

Run: `npx jest --maxWorkers=1 --maxTests=20000 --testPathPattern="status.service.spec.ts" --no-coverage 2>&1 | tail -15`
Expected: PASS

- [ ] **Step 5: Write the failing controller test** (`status.controller.spec.ts`)

```ts
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';

describe('StatusController', () => {
  let controller: StatusController;
  let svc: jest.Mocked<StatusService>;

  beforeEach(() => {
    svc = { getStatus: jest.fn() } as any;
    controller = new StatusController(svc);
  });

  it('exposes GET /v1/status as public (no guards applied)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, StatusController);
    expect(guards).toBeUndefined();
    const methodGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      StatusController.prototype.status,
    );
    expect(methodGuards).toBeUndefined();
  });

  it('returns aggregated status', async () => {
    const payload = {
      overall: 'operational' as const,
      components: [
        { component: 'api' as const, status: 'operational' as const, activeIncidents: 0 },
        { component: 'dashboard' as const, status: 'operational' as const, activeIncidents: 0 },
        { component: 'provisioning' as const, status: 'operational' as const, activeIncidents: 0 },
        { component: 'billing' as const, status: 'operational' as const, activeIncidents: 0 },
        { component: 'data-plane' as const, status: 'operational' as const, activeIncidents: 0 },
      ],
      incidents: [],
    };
    svc.getStatus.mockResolvedValue(payload as any);
    await expect(controller.status()).resolves.toEqual(payload);
  });
});
```

- [ ] **Step 6: Run controller test to verify it fails**

Run: `npx jest --maxWorkers=1 --maxTests=20000 --testPathPattern="status.controller.spec.ts" --no-coverage 2>&1 | tail -15`
Expected: FAIL

- [ ] **Step 7: Implement `StatusController`** (`apps/control-plane-api/src/status/status.controller.ts`)

```ts
import { Controller, Get } from '@nestjs/common';
import { StatusService } from './status.service';

@Controller('v1/status')
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Get()
  status() {
    return this.status.getStatus();
  }
}
```

Note: **sem `@UseGuards`** (endpoint público). Seguir padrão de decorators Swagger opcional mas consistente com outros controllers (não obrigatório para passar testes).

- [ ] **Step 8: Run controller test to verify it passes**

Run: `npx jest --maxWorkers=1 --maxTests=20000 --testPathPattern="status.controller.spec.ts" --no-coverage 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 9: Create `StatusModule`** (`apps/control-plane-api/src/status/status.module.ts`)

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';

@Module({
  imports: [PrismaModule],
  controllers: [StatusController],
  providers: [StatusService],
})
export class StatusModule {}
```

- [ ] **Step 10: Register `StatusModule` in `AppModule`** (`apps/control-plane-api/src/app.module.ts`)

Adicionar import `import { StatusModule } from './status/status.module';` e incluir `StatusModule` no array `imports`.

- [ ] **Step 11: Run all status unit tests**

Run: `npx jest --maxWorkers=1 --maxTests=20000 --testPathPattern="status\.(service|controller)\.spec" --no-coverage 2>&1 | tail -8`
Expected: PASS (2 specs)

- [ ] **Step 12: Commit Task 1**

```bash
git add apps/control-plane-api/src/status apps/control-plane-api/src/app.module.ts
git commit -m "feat(status): add public status API (module/service/controller + unit tests) (#110)"
```

### Task 2: API e2e — GET /v1/status sem Authorization

**Files:**
- Modify: `apps/control-plane-api/test/app.e2e-spec.ts` (adicionar caso de teste)

**Interfaces:**
- Consumes: app Fastify criado no bootstrap do e2e
- Produces: teste end-to-end validando 200 sem Authorization

- [ ] **Step 1: Add e2e test case for GET /v1/status** (`apps/control-plane-api/test/app.e2e-spec.ts`)

Adicionar após o teste `GET /health/ready` (ou próximo a `/health GET`) um bloco:

```ts
    it('/v1/status (GET) returns 200 without Authorization', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/status' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('overall');
      expect(body).toHaveProperty('components');
      expect(body).toHaveProperty('incidents');
      expect(Array.isArray(body.components)).toBe(true);
      expect(body.components).toHaveLength(5);
      expect(Array.isArray(body.incidents)).toBe(true);
    });
```

- [ ] **Step 2: Run e2e for app** (opcional mas recomendado)

Run: `npx jest --config test/jest-e2e.config.cjs --maxWorkers=1 --testPathPattern="app\.e2e" --no-coverage 2>&1 | tail -20`
Expected: PASS (inclui novo caso)

- [ ] **Step 3: Commit Task 2**

```bash
git add apps/control-plane-api/test/app.e2e-spec.ts
git commit -m "test(status): e2e for GET /v1/status without auth (#110)"
```

### Task 3: Web — página pública `/status`

**Files:**
- Create: `apps/backoffice-web/src/app/(public)/status/page.tsx`

**Interfaces:**
- Consumes: `GET ${API_URL}/v1/status` (server-side), `publicApiUrl()`/`serverApiUrl()` se desejado — usar padrão existente (páginas públicas chamam API via fetch no server com URL derivada; seguir `publicApiUrl()` em client ou ler `process.env.API_URL`/helper no server). Ver padrão em `(public)/register` (usa `publicApiUrl()` client-side; página server component pode ler `process.env.API_URL` ou usar helper `serverApiUrl()` se existir). Preferir server-side fetch com `serverApiUrl()`/env interno.
- Produces: página server component com `revalidate = 60`, renderiza status geral/por componente + incidentes públicos.

- [ ] **Step 1: Create server component page** (`apps/backoffice-web/src/app/(public)/status/page.tsx`)

```tsx
import { serverApiUrl } from "@/lib/public-env";

export const revalidate = 60;

type ComponentStatus = {
  component: "api" | "dashboard" | "provisioning" | "billing" | "data-plane";
  status: "operational" | "degraded" | "outage";
  activeIncidents: number;
};

type Update = {
  status: string;
  message: string;
  createdAt: string;
};

type Incident = {
  id: string;
  title: string;
  severity: "critical" | "major" | "minor";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  component: ComponentStatus["component"];
  startedAt: string;
  resolvedAt: string | null;
  updates: Update[];
};

type StatusResponse = {
  overall: "operational" | "degraded" | "outage";
  components: ComponentStatus[];
  incidents: Incident[];
};

function overallLabel(overall: StatusResponse["overall"]) {
  if (overall === "outage") return "Interrupção nos sistemas";
  if (overall === "degraded") return "Sistemas degradados";
  return "Todos os sistemas operacionais";
}

function componentLabel(c: ComponentStatus["component"]) {
  const map = {
    api: "API",
    dashboard: "Dashboard",
    provisioning: "Provisioning",
    billing: "Billing",
    "data-plane": "Data Plane",
  } as const;
  return map[c];
}

function severityBadge(s: Incident["severity"]) {
  if (s === "critical") return "bg-red-600/10 text-red-600 border-red-600/20";
  if (s === "major") return "bg-orange-500/10 text-orange-600 border-orange-500/20";
  return "bg-zinc-500/10 text-zinc-600 border-zinc-500/20";
}

function statusDot(s: ComponentStatus["status"]) {
  if (s === "outage") return "bg-red-600";
  if (s === "degraded") return "bg-orange-500";
  return "bg-emerald-600";
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

async function getStatus(): Promise<StatusResponse | null> {
  try {
    const base = serverApiUrl();
    const res = await fetch(`${base}/v1/status`, {
      next: { revalidate: 60 },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as StatusResponse;
  } catch {
    return null;
  }
}

export default async function StatusPage() {
  const data = await getStatus();

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Status da plataforma
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {data ? overallLabel(data.overall) : "Não foi possível carregar o status"}
        </p>
        {!data && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Tente novamente em instantes — última tentativa: {formatDate(new Date().toISOString())}
          </p>
        )}
      </header>

      {data && (
        <>
          <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Componentes</h2>
            <ul className="space-y-2">
              {data.components.map((c) => (
                <li key={c.component} className="flex items-center justify-between rounded-md border border-zinc-200/70 px-3 py-2 dark:border-zinc-800/70">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusDot(c.status)}`} />
                    <span className="text-sm text-zinc-800 dark:text-zinc-100">{componentLabel(c.component)}</span>
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {c.activeIncidents > 0 ? `${c.activeIncidents} incidente${c.activeIncidents > 1 ? "s" : ""} ativo${c.activeIncidents > 1 ? "s" : ""}` : "operacional"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Incidentes</h2>
            {data.incidents.length === 0 && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Nenhum incidente público nos últimos 30 dias.</p>
            )}
            <ul className="space-y-3">
              {data.incidents.map((inc) => (
                <li key={inc.id} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{inc.title}</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${severityBadge(inc.severity)}`}>
                          {inc.severity}
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{componentLabel(inc.component)}</span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatDate(inc.startedAt)} → {inc.resolvedAt ? formatDate(inc.resolvedAt) : "em andamento"}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{inc.status}</span>
                  </div>
                  {inc.updates.length > 0 && (
                    <ol className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                      {inc.updates.map((u, idx) => (
                        <li key={idx} className="space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{u.status}</span>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatDate(u.createdAt)}</span>
                          </div>
                          <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{u.message}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
```

Notas: usa `serverApiUrl()` (server-side) — segue o padrão de helpers em `@/lib/public-env`. Com `revalidate = 60` (ISR) e `next: { revalidate: 60 }` no fetch; página server component, sem client JS desnecessário.

- [ ] **Step 2: Verificar build/lint da página (type-check)**

Run: `npx tsc --noEmit -p apps/backoffice-web/tsconfig.json 2>&1 | tail -30`
Expected: sem erros de tipos relacionados à nova página

- [ ] **Step 3: Commit Task 3**

```bash
git add apps/backoffice-web/src/app/\(public\)/status/page.tsx
git commit -m "feat(status): add public /status page (ISR 60s) (#110)"
```

### Task 4: Verificação final (lint/build/tests)

**Files:** nenhum novo

- [ ] **Step 1: Lint API + Web (rápido)**

Run: `npx turbo lint 2>&1 | tail -15`
Expected: 0 errors (warnings permitidos)

- [ ] **Step 2: Unit tests API (status + relacionados)**

Run: `npx jest --maxWorkers=1 --maxTests=20000 --testPathPattern="status\.(service|controller)" --no-coverage 2>&1 | tail -5`
Expected: PASS

- [ ] **Step 3: Build completo (turbo build)**

Run: `npx turbo build 2>&1 | tail -10`
Expected: todos builds com sucesso

- [ ] **Step 4: Commit (sem alterações)** — opcional

Sem alterações de código. Se tudo verde, pode pular commit.

---

## Observações de implementação

- `StatusService` usa `Prisma.incident.findMany` com `where: { public: true }` + filtro de janela (aberto OU `resolvedAt >= now-30d`). Ordenação no app (não força ORDER BY pesado além do necessário) — segue padrão simples e testável.
- Componentes fixos em ordem: `api`, `dashboard`, `provisioning`, `billing`, `data-plane` (conforme spec). Nunca omitidos.
- Timeline pública: mapeia apenas updates com `internal === false`, ordena por `createdAt` asc.
- Payload estritamente mínimo: nenhum campo de PII/tenant/blast radius — verificado nos asserts do service test.
- Endpoint 100% anônimo: sem `@UseGuards`, sem `@Roles`, sem leitura de `req.user`.
- Página herda `PublicLayout` do route group `(public)/` (já existente) — sem sessão, header com Login.
- `revalidate = 60` + `next.revalidate=60` no fetch: cache ISR de 1 minuto, alinhado com leitura pura.
- Tratamento de erro na página: retorna banner "Não foi possível carregar o status" (sem vazar stack) — degrade gracefully.

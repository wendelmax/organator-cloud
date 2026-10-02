import test, { describe, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Server actions dependem de next-auth e next/cache: ambos mockados.
let currentSession: any = null;
const revalidated: string[] = [];
mock.module('next-auth', {
  namedExports: { getServerSession: async () => currentSession },
});
mock.module('next/cache', {
  namedExports: { revalidatePath: (p: string) => void revalidated.push(p) },
});

let services: typeof import('./(dashboard)/services/actions');
let plans: typeof import('./(dashboard)/billing/plans/actions');
let tenants: typeof import('./(dashboard)/tenants/actions');

before(async () => {
  services = await import('./(dashboard)/services/actions');
  plans = await import('./(dashboard)/billing/plans/actions');
  tenants = await import('./(dashboard)/tenants/actions');
});

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

function mockFetch(status = 200, body: unknown = {}) {
  return mock.method(globalThis, 'fetch', async () => ({ ok: status < 400, status, json: async () => body }) as any);
}
const lastCall = (m: any) => {
  const [url, init] = m.mock.calls.at(-1).arguments;
  return { url: url as string, init, body: init?.body ? JSON.parse(init.body) : undefined };
};

beforeEach(() => {
  currentSession = { accessToken: 'jwt-1', user: { email: 'o@acme.com', tenantId: 't1' } };
  revalidated.length = 0;
});
afterEach(() => mock.restoreAll());

describe('authentication guard', () => {
  test('every mutating action refuses to run without a session token', async () => {
    currentSession = null;
    const f = mockFetch();
    await assert.rejects(services.createService(form({ name: 'x' })), /Unauthorized/);
    await assert.rejects(plans.createPlan(form({ name: 'x' })), /Unauthorized/);
    await assert.rejects(plans.togglePlan('pro'), /Unauthorized/);
    assert.deepEqual(await tenants.createTenant(form({ name: 'x' })), {
      success: false,
      error: 'Sessão expirada. Entre novamente.',
    });
    await assert.rejects(tenants.addMember(form({ email: 'a@b.c' })), /Unauthorized/);
    await assert.rejects(tenants.removeMember('u2'), /Unauthorized/);
    assert.equal(f.mock.callCount(), 0);
  });
});

describe('services actions', () => {
  test('createService sends the bearer token and the tenant of the session', async () => {
    const f = mockFetch();
    await services.createService(form({ name: 'api', cloudProvider: 'VERCEL', repository: 'acme/api' }));
    const { url, init, body } = lastCall(f);

    assert.match(url, /\/v1\/services$/);
    assert.equal(init.headers.Authorization, 'Bearer jwt-1');
    assert.deepEqual(body, { name: 'api', cloudProvider: 'VERCEL', repositoryUrl: 'acme/api' });
    assert.deepEqual(revalidated, ['/services']);
  });

  test('createService surfaces API failures and does not revalidate', async () => {
    mockFetch(403);
    await assert.rejects(services.createService(form({ name: 'api' })), /Failed to create service/);
    assert.deepEqual(revalidated, []);
  });
});

describe('billing plan actions', () => {
  test('createPlan converts USD to cents and parses JSON quotas/features', async () => {
    const f = mockFetch();
    await plans.createPlan(
      form({ name: 'Pro', slug: 'pro', priceUsd: '49.99', quotas: '{"MICROSERVICE":10}', features: '{"sso":true}', sortOrder: '2' }),
    );
    const { body } = lastCall(f);
    assert.equal(body.price, 4999);
    assert.deepEqual(body.quotas, { MICROSERVICE: 10 });
    assert.deepEqual(body.features, { sso: true });
    assert.equal(body.sortOrder, 2);
    assert.equal(body.currency, 'usd');
    assert.equal(body.cycle, 'monthly');
    assert.equal(body.status, 'active');
    assert.equal(body.syncStripe, true);
    assert.deepEqual(revalidated, ['/billing/plans']);
  });

  test('createPlan rejects invalid JSON before calling the API', async () => {
    const f = mockFetch();
    await assert.rejects(plans.createPlan(form({ name: 'Pro', slug: 'pro', quotas: '{bad' })), /JSON inválido/);
    assert.equal(f.mock.callCount(), 0);
  });

  test('empty JSON fields default to {}', async () => {
    const f = mockFetch();
    await plans.createPlan(form({ name: 'Free', slug: 'free', quotas: '  ' }));
    assert.deepEqual(lastCall(f).body.quotas, {});
  });

  test('updatePlan requires a slug and PATCHes the plan', async () => {
    await assert.rejects(plans.updatePlan(form({ name: 'x' })), /Slug do plano é obrigatório/);
    const f = mockFetch();
    await plans.updatePlan(form({ slug: 'pro', name: 'Pro', priceUsd: '10' }));
    const { url, init, body } = lastCall(f);
    assert.match(url, /\/v1\/billing\/plans\/pro$/);
    assert.equal(init.method, 'PATCH');
    assert.equal(body.price, 1000);
    assert.equal(body.slug, undefined);
  });

  test('propagates the API error message', async () => {
    mockFetch(409, { message: 'Slug já existe' });
    await assert.rejects(plans.createPlan(form({ name: 'Pro', slug: 'pro' })), /Slug já existe/);
    mockFetch(500, {});
    await assert.rejects(plans.togglePlan('pro'), /Falha na requisição/);
  });

  test('listPlans returns [] when the API refuses', async () => {
    mockFetch(403);
    assert.deepEqual(await plans.listPlans(), []);
    mockFetch(200, [{ slug: 'pro' }]);
    assert.deepEqual(await plans.listPlans(), [{ slug: 'pro' }]);
  });
});

describe('tenant actions', () => {
  test('createTenant returns a readable error instead of throwing (no error-boundary crash)', async () => {
    mockFetch(403, { message: 'Forbidden resource' });
    assert.deepEqual(await tenants.createTenant(form({ name: 'Acme' })), {
      success: false,
      error: 'Apenas administradores da plataforma podem criar tenants.',
    });
    mockFetch(400, { message: ['name should not be empty'] });
    assert.deepEqual(await tenants.createTenant(form({ name: '' })), {
      success: false,
      error: 'name should not be empty',
    });
    assert.deepEqual(revalidated, []);
  });

  test('createTenant uses the session email as the admin and defaults to free', async () => {
    const f = mockFetch();
    await tenants.createTenant(form({ name: 'Acme' }));
    assert.deepEqual(lastCall(f).body, { name: 'Acme', plan: 'free', adminEmail: 'o@acme.com' });
    assert.deepEqual(revalidated, ['/tenants']);
  });

  test('createTenant sends the owner e-mail from the form when provided', async () => {
    const f = mockFetch();
    await tenants.createTenant(form({ name: 'Acme', ownerEmail: '  ceo@acme.com ' }));
    assert.equal(lastCall(f).body.adminEmail, 'ceo@acme.com');
  });

  test('addMember defaults to the least privileged role', async () => {
    const f = mockFetch();
    await tenants.addMember(form({ email: 'new@acme.com' }));
    assert.equal(lastCall(f).body.role, 'VIEWER');
  });

  test('member management hits the right endpoints and surfaces errors', async () => {
    const f = mockFetch();
    await tenants.updateMemberRole('u2', 'ADMIN');
    assert.match(lastCall(f).url, /\/v1\/tenants\/members\/u2\/role$/);
    assert.equal(lastCall(f).init.method, 'PATCH');
    assert.deepEqual(lastCall(f).body, { role: 'ADMIN' });

    await tenants.removeMember('u2');
    assert.match(lastCall(f).url, /\/v1\/tenants\/members\/u2$/);
    assert.equal(lastCall(f).init.method, 'DELETE');

    mockFetch(403, { message: 'Somente OWNER' });
    await assert.rejects(tenants.updateMemberRole('u2', 'OWNER'), /Somente OWNER/);
  });

  test('getMembers fails loudly', async () => {
    mockFetch(500);
    await assert.rejects(tenants.getMembers(), /Failed to fetch members/);
  });
});

describe('tenant infrastructure actions', () => {
  // Estas rotas ficam em /v1/tenants/:id (TenantsController); o prefixo
  // /v1/platform/tenants só existe para data-isolation e dava 404.
  test('provision, clone and offboard call the existing API routes', async () => {
    const f = mockFetch(200, { jobId: 'j1', status: 'QUEUED' });

    await tenants.provisionInfra('t9');
    assert.equal(lastCall(f).url, 'http://localhost:3001/v1/tenants/t9/provision-infra');
    assert.equal(lastCall(f).init.method, 'POST');

    await tenants.cloneTenantEnvironment('t9', 'acme-copy', 'Acme Copy');
    assert.equal(lastCall(f).url, 'http://localhost:3001/v1/tenants/t9/clone');
    assert.deepEqual(lastCall(f).body, { targetSlug: 'acme-copy', targetName: 'Acme Copy' });

    await tenants.offboardTenantEnvironment('t9');
    assert.equal(lastCall(f).url, 'http://localhost:3001/v1/tenants/t9/offboard');
    assert.equal(lastCall(f).init.method, 'DELETE');
    assert.equal(lastCall(f).init.headers.Authorization, 'Bearer jwt-1');
  });
});

describe('service deploy action', () => {
  test('starts a deploy in the chosen environment and returns it', async () => {
    const f = mockFetch(200, { id: 'dep-1', status: 'PENDING', logs: null, createdAt: '2026-10-02T00:00:00Z' });

    const result = await services.triggerDeploy('svc 1', 'staging');

    assert.deepEqual(result, {
      success: true,
      deployment: { id: 'dep-1', status: 'PENDING', logs: null, createdAt: '2026-10-02T00:00:00Z' },
    });
    const { url, init, body } = lastCall(f);
    assert.equal(url, 'http://localhost:3001/v1/services/svc%201/deploy');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer jwt-1');
    assert.deepEqual(body, { environment: 'staging' });
    assert.deepEqual(revalidated, ['/services/svc 1']);
  });

  test('returns the API message on failure (e.g. quota) instead of throwing', async () => {
    mockFetch(403, { message: 'Quota exceeded for DEPLOYMENT' });
    assert.deepEqual(await services.triggerDeploy('svc-1'), {
      success: false,
      error: 'Quota exceeded for DEPLOYMENT',
    });
  });

  test('asks to sign in again without a session', async () => {
    currentSession = null;
    const f = mockFetch();
    assert.deepEqual(await services.triggerDeploy('svc-1'), {
      success: false,
      error: 'Sessão expirada. Entre novamente.',
    });
    assert.equal(f.mock.callCount(), 0);
  });
});

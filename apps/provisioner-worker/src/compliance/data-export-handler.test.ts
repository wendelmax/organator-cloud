import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTenantExport,
  buildUserExport,
  handleGenerateDataExport,
  EXPORT_TTL_DAYS,
} from './data-export-handler.js';

function fakePrisma(overrides: { user?: any; request?: any } = {}) {
  const updates: any[] = [];
  const selects: Record<string, any> = {};
  const capture = (name: string, rows: unknown[]) => async (args: any) => {
    selects[name] = args;
    return rows;
  };
  const prisma: any = {
    user: {
      findUnique: async (args: any) => {
        selects.user = args;
        return 'user' in overrides
          ? overrides.user
          : { id: 'u1', email: 'owner@acme.com', name: 'Owner', role: 'OWNER' };
      },
    },
    tenantMembership: { findMany: capture('memberships', [{ role: 'OWNER' }]) },
    userSession: { findMany: capture('sessions', [{ ip: '10.0.0.1' }]) },
    apiKey: { findMany: capture('apiKeys', [{ name: 'ci', prefix: 'sk_ab12' }]) },
    tenantInvitation: { findMany: capture('invitations', []) },
    auditLog: { findMany: capture('activity', [{ action: 'auth.login_succeeded' }]) },
    consent: { findMany: capture('consents', [{ purpose: 'terms', version: '2026-10' }]) },
    dataExport: {
      findUnique: async () =>
        'request' in overrides ? overrides.request : { id: 'e1', userId: 'u1', status: 'PENDING' },
      update: async (args: any) => void updates.push(args),
    },
  };
  return { prisma, updates, selects };
}

describe('buildUserExport', () => {
  test('collects the personal data of the subject in a readable document', async () => {
    const { prisma, selects } = fakePrisma();
    const doc: any = await buildUserExport(prisma, 'u1');

    assert.equal(doc.format, 'organator.user-export.v1');
    assert.equal(doc.profile.email, 'owner@acme.com');
    assert.deepEqual(doc.memberships, [{ role: 'OWNER' }]);
    assert.deepEqual(doc.activity, [{ action: 'auth.login_succeeded' }]);
    assert.deepEqual(doc.consents, [{ purpose: 'terms', version: '2026-10' }]);
    assert.deepEqual(selects.consents.where, { userId: 'u1' });
    // Escopo do titular.
    assert.deepEqual(selects.sessions.where, { userId: 'u1' });
    assert.deepEqual(selects.apiKeys.where, { createdBy: 'u1' });
    assert.deepEqual(selects.activity.where, { actorId: 'u1' });
    assert.deepEqual(selects.invitations.where, { email: 'owner@acme.com' });
  });

  test('never selects secrets', async () => {
    const { prisma, selects } = fakePrisma();
    await buildUserExport(prisma, 'u1');

    const selected = JSON.stringify([selects.user.select, selects.sessions.select, selects.apiKeys.select]);
    for (const secret of ['password"', 'mfaSecretEncrypted', 'tokenHash', '"hash"']) {
      assert.ok(!selected.includes(secret), `${secret} must not be exported`);
    }
  });
});

describe('handleGenerateDataExport', () => {
  test('stores the document and makes it available for a limited time', async () => {
    const { prisma, updates } = fakePrisma();
    const before = Date.now();
    await handleGenerateDataExport({ data: { exportId: 'e1' } } as any, prisma);

    const { data } = updates[0];
    assert.equal(data.status, 'READY');
    assert.equal(data.content.profile.id, 'u1');
    const ttl = data.expiresAt.getTime() - before;
    assert.ok(ttl > (EXPORT_TTL_DAYS - 0.01) * 86_400_000 && ttl <= EXPORT_TTL_DAYS * 86_400_000 + 1000);
  });

  test('marks the export FAILED and rethrows when it cannot be built', async () => {
    const { prisma, updates } = fakePrisma({ user: null });
    await assert.rejects(handleGenerateDataExport({ data: { exportId: 'e1' } } as any, prisma), /not found/);
    assert.equal(updates[0].data.status, 'FAILED');
  });

  test('is a no-op for a request that is no longer pending (repeated job)', async () => {
    const { prisma, updates } = fakePrisma({ request: { id: 'e1', userId: 'u1', status: 'READY' } });
    await handleGenerateDataExport({ data: { exportId: 'e1' } } as any, prisma);
    assert.equal(updates.length, 0);
  });
});

describe('buildTenantExport', () => {
  function tenantPrisma(tenant: any = { id: 't1', name: 'Acme', slug: 'acme' }) {
    const args: Record<string, any> = {};
    const capture = (name: string, rows: unknown[]) => async (a: any) => {
      args[name] = a;
      return rows;
    };
    const prisma: any = {
      tenant: { findUnique: async () => tenant },
      user: { findMany: capture('members', [{ id: 'u1' }, { id: 'u2' }]) },
      microservice: { findMany: capture('services', [{ id: 's1' }]) },
      domain: { findMany: capture('domains', []) },
      tenantInvitation: { findMany: capture('invitations', []) },
      auditLog: { findMany: capture('audit', [{ action: 'tenant.created' }]) },
      dataExport: {
        findUnique: async () => ({ id: 'e2', userId: 'admin', status: 'PENDING', scope: 'TENANT', tenantId: 't1' }),
        update: async (a: any) => void (args.update = a),
      },
    };
    return { prisma, args };
  }

  test('exports the tenant dataset scoped to that tenant', async () => {
    const { prisma, args } = tenantPrisma();
    const doc: any = await buildTenantExport(prisma, 't1');

    assert.equal(doc.format, 'organator.tenant-export.v1');
    assert.equal(doc.tenant.slug, 'acme');
    assert.deepEqual(args.members.where, {
      OR: [{ tenantId: 't1' }, { memberships: { some: { tenantId: 't1', status: 'active' } } }],
    });
    assert.deepEqual(args.services.where, { tenantId: 't1' });
    // Auditoria do tenant e dos seus membros.
    assert.deepEqual(args.audit.where, {
      OR: [{ resourceId: 't1' }, { actorId: { in: ['u1', 'u2'] } }],
    });
    const selected = JSON.stringify([args.members.select, args.services.select]);
    for (const secret of ['password', 'mfaSecretEncrypted', 'encryptedConnection']) {
      assert.ok(!selected.includes(secret), `${secret} must not be exported`);
    }
  });

  test('the job builds a TENANT request with the tenant dataset', async () => {
    const { prisma, args } = tenantPrisma();
    await handleGenerateDataExport({ data: { exportId: 'e2' } } as any, prisma);
    assert.equal(args.update.data.status, 'READY');
    assert.equal(args.update.data.content.format, 'organator.tenant-export.v1');
  });

  test('fails for an unknown tenant', async () => {
    const { prisma } = tenantPrisma(null);
    await assert.rejects(buildTenantExport(prisma, 'nope'), /not found/);
  });
});

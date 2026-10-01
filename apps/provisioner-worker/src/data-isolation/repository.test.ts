import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { IsolationRepository } from './repository.js';

function fakePrisma(overrides: Record<string, any> = {}) {
  const calls: Record<string, any[]> = { update: [], raw: [], audit: [], tx: [] };
  const prisma: any = {
    tenant: { findUnique: async () => null },
    tenantDataPlane: {
      update: async (args: any) => {
        calls.update.push(args);
        return args;
      },
    },
    auditLog: {
      create: async (args: any) => {
        calls.audit.push(args);
      },
    },
    $transaction: async (arg: any) => {
      calls.tx.push(arg);
      if (typeof arg === 'function') {
        return arg({ $executeRawUnsafe: async (...a: any[]) => calls.raw.push(a) });
      }
      return Promise.all(arg);
    },
    ...overrides,
  };
  return { prisma, calls };
}

describe('IsolationRepository', () => {
  test('load returns null without tenant or data plane', async () => {
    const { prisma } = fakePrisma();
    const repo = new IsolationRepository(prisma);
    assert.equal(await repo.load('t1'), null);
    prisma.tenant.findUnique = async () => ({ id: 't1', dataPlane: null });
    assert.equal(await repo.load('t1'), null);
  });

  test('load maps tenant + data plane into a snapshot with safe defaults', async () => {
    const { prisma } = fakePrisma({
      tenant: {
        findUnique: async () => ({
          id: 't1',
          dataIsolation: 'SCHEMA',
          dataPlane: {
            generation: 3,
            observedGeneration: 2,
            activeIsolation: 'SHARED',
            status: 'RECONCILING',
            phase: 'COPY',
            resourceState: null,
            encryptedConnection: null,
            lastError: null,
          },
        }),
      },
    });
    assert.deepEqual(await new IsolationRepository(prisma).load('t1'), {
      tenantId: 't1',
      generation: 3,
      observedGeneration: 2,
      desiredMode: 'SCHEMA',
      activeIsolation: 'SHARED',
      status: 'RECONCILING',
      phase: 'COPY',
      resourceState: {},
      encryptedConnection: null,
      lastError: null,
    });
  });

  test('withTenantLock takes a transaction-scoped advisory lock before running fn', async () => {
    const { prisma, calls } = fakePrisma();
    const order: string[] = [];
    prisma.$transaction = async (fn: any) =>
      fn({
        $executeRawUnsafe: async (sql: string, id: string) => {
          order.push('lock');
          calls.raw.push([sql, id]);
        },
      });

    const result = await new IsolationRepository(prisma).withTenantLock('t1', async () => {
      order.push('fn');
      return 42;
    });

    assert.equal(result, 42);
    assert.deepEqual(order, ['lock', 'fn']);
    assert.match(calls.raw[0][0], /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
    assert.equal(calls.raw[0][1], 't1');
  });

  test('checkpoint marks RECONCILING and only writes provided fields', async () => {
    const { prisma, calls } = fakePrisma();
    const repo = new IsolationRepository(prisma);
    await repo.checkpoint({ tenantId: 't1', generation: 1, phase: 'COPY' });
    await repo.checkpoint({ tenantId: 't1', generation: 1, phase: 'FAILED', resourceState: { a: 1 }, lastError: null });

    assert.deepEqual(calls.update[0], { where: { tenantId: 't1' }, data: { phase: 'COPY', status: 'RECONCILING' } });
    assert.deepEqual(calls.update[1].data, { phase: 'FAILED', status: 'FAILED', resourceState: { a: 1 }, lastError: null });
  });

  test('cutover marks READY, bumps observedGeneration and stores the connection reference', async () => {
    const { prisma, calls } = fakePrisma();
    await new IsolationRepository(prisma).cutover({
      tenantId: 't1',
      generation: 5,
      mode: 'DATABASE',
      storedConnection: { reference: { id: 'ref-5', mode: 'DATABASE' }, encryptedPayload: { url: 'enc' } } as any,
      resourceState: { database: 'org_t1' },
    });
    const data = calls.update[0].data;
    assert.equal(data.status, 'READY');
    assert.equal(data.phase, 'READY');
    assert.equal(data.observedGeneration, 5);
    assert.equal(data.activeIsolation, 'DATABASE');
    assert.deepEqual(data.encryptedConnection, { url: 'enc' });
    assert.deepEqual(data.resourceState, { database: 'org_t1', activeConnectionReference: 'ref-5' });
    assert.equal(data.lastError, null);
    assert.ok(data.completedAt instanceof Date);
  });

  test('fail stores a coded error message', async () => {
    const { prisma, calls } = fakePrisma();
    await new IsolationRepository(prisma).fail({ tenantId: 't1', generation: 1, phase: 'COPY', code: 'E_X', message: 'boom' });
    assert.deepEqual(calls.update[0].data, { status: 'FAILED', phase: 'COPY', lastError: '[E_X] boom' });
  });

  test('recordAudit prefixes the action and never throws', async () => {
    const { prisma, calls } = fakePrisma();
    const repo = new IsolationRepository(prisma);
    await repo.recordAudit({ tenantId: 't1', generation: 1, deploymentId: 'd', action: 'cutover_completed', changes: { a: 1 } });
    assert.equal(calls.audit[0].data.action, 'data_isolation.cutover_completed');
    assert.equal(calls.audit[0].data.resourceId, 't1');

    prisma.auditLog.create = async () => {
      throw new Error('db down');
    };
    await assert.doesNotReject(repo.recordAudit({ tenantId: 't1', generation: 1, deploymentId: 'd', action: 'x', changes: {} }));
  });
});

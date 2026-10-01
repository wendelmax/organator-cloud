import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createJobProcessor } from './worker.js';

const job = (name: string, data: Record<string, unknown> = {}) => ({ name, data }) as any;

describe('createJobProcessor', () => {
  test('routes reconcile-data-isolation to the reconciler with prisma', async () => {
    const prisma = {} as any;
    const calls: any[] = [];
    const process = createJobProcessor({
      prisma,
      reconcileDataIsolation: async (j, p) => {
        calls.push([j.name, p]);
        return { success: true, status: 'SUCCESS' };
      },
    });

    assert.deepEqual(await process(job('reconcile-data-isolation')), { success: true, status: 'SUCCESS' });
    assert.equal(calls[0][1], prisma);
  });

  test('throws on FAILED reconciliation so BullMQ retries it', async () => {
    const process = createJobProcessor({
      prisma: {} as any,
      reconcileDataIsolation: async () => ({ success: false, status: 'FAILED', message: 'copy failed' }),
    });
    await assert.rejects(process(job('reconcile-data-isolation')), /copy failed/);
  });

  test('uses a default message when the failure has none', async () => {
    const process = createJobProcessor({
      prisma: {} as any,
      reconcileDataIsolation: async () => ({ success: false, status: 'FAILED' }),
    });
    await assert.rejects(process(job('reconcile-data-isolation')), /Data isolation reconciliation failed/);
  });

  test('does not retry STALE jobs (a newer generation superseded them)', async () => {
    const process = createJobProcessor({
      prisma: {} as any,
      reconcileDataIsolation: async () => ({ success: false, status: 'STALE' }),
    });
    assert.deepEqual(await process(job('reconcile-data-isolation')), { success: false, status: 'STALE' });
  });

  test('dispatches registered handlers by job name', async () => {
    const seen: string[] = [];
    const process = createJobProcessor({
      prisma: {} as any,
      handlers: {
        'deploy-tenant-infra': async (j) => {
          seen.push(j.data.tenantId);
          return { ok: 1 };
        },
      },
    });
    assert.deepEqual(await process(job('deploy-tenant-infra', { tenantId: 't1' })), { ok: 1 });
    assert.deepEqual(seen, ['t1']);
  });

  test('propagates handler errors', async () => {
    const process = createJobProcessor({
      prisma: {} as any,
      handlers: { boom: async () => { throw new Error('boom'); } },
    });
    await assert.rejects(process(job('boom')), /boom/);
  });

  test('acknowledges unknown jobs', async () => {
    const process = createJobProcessor({ prisma: {} as any });
    assert.deepEqual(await process(job('unknown')), { success: true });
  });
});

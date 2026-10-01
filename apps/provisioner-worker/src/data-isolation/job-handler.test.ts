import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleReconcileDataIsolation } from './job-handler.js';

function prismaWith(tenant: unknown) {
  return {
    tenant: { findUnique: async () => tenant },
    $transaction: async (fn: any) => fn({ $executeRawUnsafe: async () => 1 }),
  } as any;
}

const job = (generation: number) =>
  ({ data: { apiVersion: 'organator.io/v1alpha1', tenantId: 't1', generation, desiredMode: 'SCHEMA' } }) as any;

describe('handleReconcileDataIsolation', () => {
  test('reports FAILED when the tenant has no data plane', async () => {
    const result = await handleReconcileDataIsolation(job(1), prismaWith(null));
    assert.deepEqual(result, { success: false, status: 'FAILED', message: 'Tenant data plane not found' });
  });

  test('reports STALE (not a failure) for superseded generations', async () => {
    const tenant = {
      id: 't1',
      dataIsolation: 'SCHEMA',
      dataPlane: { generation: 5, observedGeneration: 4, status: 'PENDING', phase: 'PREPARE', resourceState: {}, encryptedConnection: null, activeIsolation: 'SHARED', lastError: null },
    };
    const result = await handleReconcileDataIsolation(job(4), prismaWith(tenant));
    assert.equal(result.success, false);
    assert.equal(result.status, 'STALE');
  });
});

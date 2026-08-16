import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleReconcilePlanMigration } from './plan-migration-handler.js';

describe('plan-migration-handler', () => {
  test('returns success true for valid plan migration job', async () => {
    const mockPrisma: any = {
      tenant: { findUnique: async () => ({ id: 't-1', plan: 'Enterprise' }) },
      tenantDataPlane: { upsert: async () => {} },
    };
    const mockJob: any = { data: { tenantId: 't-1', currentPlan: 'Free', targetPlan: 'Enterprise' } };

    const result = await handleReconcilePlanMigration(mockJob, mockPrisma);
    assert.equal(result.success, true);
  });
});

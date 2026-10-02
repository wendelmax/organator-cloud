import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { handlePromoteTenantEnvironment } from './health-metrics-handler.js';

describe('health-metrics-handler', () => {
  test('returns success true for environment promotion job', async () => {
    const mockPrisma: any = {
      tenantEnvironment: {
        findUnique: async () => ({ id: 'env-1', envVars: { API_KEY: 'secret' } }),
        upsert: async () => ({ id: 'env-2' }),
      },
    };
    const mockJob: any = { data: { tenantId: 't-1', sourceEnvId: 'env-1' } };
    const res = await handlePromoteTenantEnvironment(mockJob, mockPrisma);
    assert.equal(res.success, true);
  });
});

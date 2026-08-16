import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleDeployRollout } from './rollout-handler.js';

describe('rollout-handler', () => {
  test('returns success true for blue-green deployment job', async () => {
    const mockPrisma: any = {
      deployment: { update: async () => {} },
    };
    const mockJob: any = { data: { deploymentId: 'd-1', strategy: 'BLUE_GREEN' } };
    const res = await handleDeployRollout(mockJob, mockPrisma);
    assert.equal(res.success, true);
  });
});

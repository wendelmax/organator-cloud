import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleBackupTenantInfra, handleRestoreTenantInfra } from './lifecycle-handlers.js';

describe('lifecycle-handlers', () => {
  test('returns success true for backup job execution', async () => {
    const mockPrisma: any = {
      tenantBackup: { create: async () => ({ id: 'b-1' }), update: async () => {} },
    };
    const mockJob: any = { data: { tenantId: 't-1', type: 'MANUAL' } };
    const res = await handleBackupTenantInfra(mockJob, mockPrisma);
    assert.equal(res.success, true);
  });

  test('returns success true for valid restore job execution', async () => {
    const mockPrisma: any = {
      tenantBackup: { findUnique: async () => ({ id: 'b-1', status: 'COMPLETED' }) },
    };
    const mockJob: any = { data: { tenantId: 't-1', backupId: 'b-1' } };
    const res = await handleRestoreTenantInfra(mockJob, mockPrisma);
    assert.equal(res.success, true);
  });
});

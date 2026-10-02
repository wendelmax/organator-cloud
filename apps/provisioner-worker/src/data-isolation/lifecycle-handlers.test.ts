import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleBackupTenantInfra,
  handleOffboardTenantInfra,
  handleRestoreTenantInfra,
} from './lifecycle-handlers.js';

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

  describe('offboarding', () => {
    function prismaFor(tenant: any, dataPlane: any = null) {
      const calls: Record<string, any[]> = { tenantUpdate: [], audit: [], backups: [] };
      const prisma: any = {
        tenant: {
          findUnique: async () => tenant,
          update: async (args: any) => void calls.tenantUpdate.push(args),
        },
        tenantDataPlane: { findUnique: async () => dataPlane },
        tenantBackup: {
          create: async (args: any) => (calls.backups.push(args), { id: 'b-1' }),
          update: async () => {},
        },
        auditLog: { create: async (args: any) => void calls.audit.push(args) },
      };
      return { prisma, calls };
    }

    test('backs up, then moves the tenant state to deleted (what the access guard reads)', async () => {
      const { prisma, calls } = prismaFor({ id: 't-1', slug: 'acme', plan: 'pro', state: 'offboarding' });
      const res = await handleOffboardTenantInfra({ data: { tenantId: 't-1', actorId: 'admin-1' } } as any, prisma);

      assert.equal(res.success, true);
      assert.equal(calls.backups[0].data.type, 'PRE_OFFBOARDING');
      assert.equal(calls.tenantUpdate.length, 1);
      assert.equal(calls.tenantUpdate[0].data.state, 'deleted');
      assert.equal(calls.tenantUpdate[0].data.status, 'archived');
      assert.equal(calls.audit[0].data.actorId, 'admin-1');
      assert.deepEqual(calls.audit[0].data.changes, {
        from: 'offboarding',
        to: 'deleted',
        reason: 'offboard-tenant-infra',
      });
    });

    test('refuses to tear down a tenant that was not put in offboarding by the API', async () => {
      const { prisma, calls } = prismaFor({ id: 't-1', slug: 'acme', state: 'active' });
      await assert.rejects(
        handleOffboardTenantInfra({ data: { tenantId: 't-1' } } as any, prisma),
        /expected offboarding/,
      );
      assert.equal(calls.backups.length, 0);
      assert.equal(calls.tenantUpdate.length, 0);
    });

    test('is a no-op for an already deleted tenant (repeated job)', async () => {
      const { prisma, calls } = prismaFor({ id: 't-1', slug: 'acme', state: 'deleted' });
      assert.deepEqual(await handleOffboardTenantInfra({ data: { tenantId: 't-1' } } as any, prisma), { success: true });
      assert.equal(calls.backups.length, 0);
    });
  });
});

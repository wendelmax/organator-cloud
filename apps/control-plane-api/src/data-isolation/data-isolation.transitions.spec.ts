import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataIsolationService } from './data-isolation.service';

describe('DataIsolationService — transitions and reconcile', () => {
  let prisma: any;
  let queue: any;
  let audit: any;
  let service: DataIsolationService;
  const tenant = (o: Record<string, unknown> = {}) => ({
    id: 't1',
    plan: 'free',
    dataIsolation: 'SHARED',
    dataIsolationOverridden: false,
    dataPlane: {
      generation: 3,
      observedGeneration: 3,
      status: 'READY',
      phase: 'READY',
      updatedAt: new Date(),
    },
    ...o,
  });

  beforeEach(() => {
    prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue(tenant()),
        update: jest.fn().mockResolvedValue({}),
      },
      tenantDataPlane: {
        upsert: jest.fn().mockResolvedValue({ generation: 4 }),
      },
      billingPlan: { findUnique: jest.fn().mockResolvedValue(null) },
      deployment: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    queue = { add: jest.fn().mockResolvedValue({}) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new DataIsolationService(prisma, audit, queue);
  });

  it('getStatus 404s for unknown tenants', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(service.getStatus('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('setOverride', () => {
    it('404s for unknown tenants', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.setOverride('x', { mode: 'SCHEMA' }, 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects invalid modes', async () => {
      await expect(
        service.setOverride('t1', { mode: 'CLUSTER' as any }, 'u1'),
      ).rejects.toThrow('Invalid isolation mode');
    });

    it('requires confirmDestructive to downgrade isolation', async () => {
      prisma.tenant.findUnique.mockResolvedValue(
        tenant({ dataIsolation: 'DATABASE' }),
      );
      await expect(
        service.setOverride('t1', { mode: 'SHARED' }, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tenant.update).not.toHaveBeenCalled();

      await service.setOverride(
        't1',
        { mode: 'SHARED', confirmDestructive: true },
        'u1',
      );
      expect(prisma.tenant.update).toHaveBeenCalled();
    });

    it('upgrades without confirmation, bumps the generation and enqueues an idempotent job', async () => {
      await service.setOverride('t1', { mode: 'DATABASE' }, 'u1');

      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { dataIsolation: 'DATABASE', dataIsolationOverridden: true },
      });
      expect(
        prisma.tenantDataPlane.upsert.mock.calls[0][0].update,
      ).toMatchObject({ generation: { increment: 1 }, status: 'PENDING' });
      expect(queue.add).toHaveBeenCalledWith(
        'reconcile-data-isolation',
        expect.objectContaining({
          tenantId: 't1',
          generation: 4,
          desiredMode: 'DATABASE',
        }),
        expect.objectContaining({
          jobId: 'data-isolation:t1:generation:4',
          attempts: 5,
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.data_isolation.override_changed',
        }),
      );
    });

    it('is a no-op when nothing changes', async () => {
      prisma.tenant.findUnique.mockResolvedValue(
        tenant({ dataIsolation: 'SCHEMA', dataIsolationOverridden: true }),
      );
      await service.setOverride('t1', { mode: 'SCHEMA' }, 'u1');
      expect(prisma.tenant.update).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('works without a queue configured', async () => {
      const noQueue = new DataIsolationService(prisma, audit);
      await expect(
        noQueue.setOverride('t1', { mode: 'SCHEMA' }, 'u1'),
      ).resolves.toBeDefined();
    });
  });

  describe('applyPlanDefault', () => {
    it('applies the plan default WITHOUT marking the tenant as manually overridden', async () => {
      prisma.billingPlan.findUnique.mockResolvedValue({
        slug: 'enterprise',
        defaultDataIsolation: 'DATABASE',
      });
      await service.applyPlanDefault('t1', 'Enterprise', 'u1');

      expect(prisma.billingPlan.findUnique).toHaveBeenCalledWith({
        where: { slug: 'enterprise' },
      });
      expect(prisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { dataIsolation: 'DATABASE', dataIsolationOverridden: false },
      });
    });

    it('applies plan-driven downgrades without asking for confirmation', async () => {
      prisma.tenant.findUnique.mockResolvedValue(
        tenant({ dataIsolation: 'DATABASE' }),
      );
      prisma.billingPlan.findUnique.mockResolvedValue({
        defaultDataIsolation: 'SHARED',
      });
      await expect(
        service.applyPlanDefault('t1', 'free', 'u1'),
      ).resolves.toBeDefined();
      expect(prisma.tenant.update).toHaveBeenCalled();
    });

    it('falls back to the built-in plan mapping', async () => {
      await service.applyPlanDefault('t1', 'pro', 'u1');
      expect(prisma.tenant.update.mock.calls[0][0].data.dataIsolation).toBe(
        'SCHEMA',
      );
    });

    it('404s for unknown tenants', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.applyPlanDefault('x', 'pro', 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reconcile', () => {
    it('404s for unknown tenants', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.reconcile('x', 'u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the existing deployment for an already reconciled generation', async () => {
      prisma.deployment.findUnique.mockResolvedValue({ id: 'dep-1' });
      await expect(service.reconcile('t1', 'u1')).resolves.toEqual({
        deploymentId: 'dep-1',
        generation: 3,
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('enqueues the current generation and audits', async () => {
      await expect(service.reconcile('t1', 'u1')).resolves.toEqual({
        generation: 3,
      });
      expect(queue.add).toHaveBeenCalledWith(
        'reconcile-data-isolation',
        expect.objectContaining({ generation: 3, desiredMode: 'SHARED' }),
        expect.objectContaining({ jobId: 'data-isolation:t1:generation:3' }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.data_isolation.reconcile_requested',
        }),
      );
    });

    it('uses generation 1 for tenants without a data plane', async () => {
      prisma.tenant.findUnique.mockResolvedValue(tenant({ dataPlane: null }));
      await expect(service.reconcile('t1', 'u1')).resolves.toEqual({
        generation: 1,
      });
    });
  });
});

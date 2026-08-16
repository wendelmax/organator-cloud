import { Test } from '@nestjs/testing';
import { DataIsolationService } from './data-isolation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { planDefaultIsolation, toDataIsolationView } from './data-isolation.types';
import { getQueueToken } from '@nestjs/bullmq';

describe('DataIsolationService', () => {
  let service: DataIsolationService;
  let prisma: any;
  let queue: any;
  let audit: any;

  beforeEach(async () => {
    prisma = {
      tenant: { findUnique: jest.fn(), update: jest.fn() },
      tenantDataPlane: { upsert: jest.fn(), update: jest.fn() },
      billingPlan: { findUnique: jest.fn() },
      deployment: { findUnique: jest.fn() },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    queue = { add: jest.fn() };
    audit = { record: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        DataIsolationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: getQueueToken('provisioner'), useValue: queue },
      ],
    }).compile();

    service = module.get(DataIsolationService);
  });

  it.each([
    ['free', 'SHARED'],
    ['pro', 'SCHEMA'],
    ['enterprise', 'DATABASE'],
  ])('maps %s to %s without an override', (plan, expected) => {
    expect(planDefaultIsolation(plan)).toBe(expected);
  });

  it('keeps an explicit Platform Admin override during plan change', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      plan: 'free',
      dataIsolation: 'DATABASE',
      dataIsolationOverridden: true,
      dataPlane: { generation: 4, observedGeneration: 4, status: 'READY', phase: 'READY', updatedAt: new Date() },
    });

    const result = await service.applyPlanDefault('tenant-1', 'pro', 'actor-1');
    expect(result.desiredMode).toBe('DATABASE');
    expect(prisma.tenantDataPlane.upsert).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('clears an override and reapplies the current plan default once', async () => {
    prisma.tenant.findUnique
      .mockResolvedValueOnce({
        id: 'tenant-1',
        plan: 'pro',
        dataIsolation: 'DATABASE',
        dataIsolationOverridden: true,
        dataPlane: { generation: 4, observedGeneration: 4, status: 'READY', phase: 'READY', updatedAt: new Date() },
      })
      .mockResolvedValue({
        id: 'tenant-1',
        plan: 'pro',
        dataIsolation: 'SCHEMA',
        dataIsolationOverridden: false,
        dataPlane: { generation: 5, observedGeneration: 4, status: 'PENDING', phase: 'PREPARE', updatedAt: new Date() },
      });
    prisma.billingPlan.findUnique.mockResolvedValue({ slug: 'pro', defaultDataIsolation: 'SCHEMA' });
    prisma.tenantDataPlane.upsert.mockResolvedValue({ generation: 5 });
    prisma.tenant.update.mockResolvedValue({});

    await service.setOverride('tenant-1', { mode: null }, 'actor-1');
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dataIsolation: 'SCHEMA', dataIsolationOverridden: false }),
      }),
    );
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile-data-isolation',
      expect.objectContaining({ tenantId: 'tenant-1', generation: 5, desiredMode: 'SCHEMA' }),
      expect.objectContaining({ jobId: 'data-isolation:tenant-1:generation:5' }),
    );
  });

  it('returns the existing deployment for a duplicate generation', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      plan: 'pro',
      dataIsolation: 'SCHEMA',
      dataIsolationOverridden: false,
      dataPlane: { generation: 5, observedGeneration: 4, status: 'PENDING' },
    });
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deployment-5',
      idempotencyKey: 'data-isolation:tenant-1:generation:5',
    });

    const result = await service.reconcile('tenant-1', 'actor-1');
    expect(result.deploymentId).toBe('deployment-5');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('never includes encrypted connection or raw resource state in the view', () => {
    const view = toDataIsolationView({
      tenantId: 'tenant-1',
      dataIsolation: 'SCHEMA',
      dataIsolationOverridden: false,
      dataPlane: {
        activeIsolation: 'SHARED',
        status: 'READY',
        phase: 'READY',
        generation: 2,
        observedGeneration: 1,
        encryptedConnection: { url: 'ciphertext' },
        resourceState: { database: 'secret-name' },
        lastError: null,
        updatedAt: new Date('2026-08-15T00:00:00Z'),
      },
    });
    expect(view).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      desiredMode: 'SCHEMA',
      activeMode: 'SHARED',
    }));
    expect(view).not.toHaveProperty('encryptedConnection');
    expect(view).not.toHaveProperty('resourceState');
  });
});

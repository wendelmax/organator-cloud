import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { getQueueToken } from '@nestjs/bullmq';

describe('Plan Migration & Downgrades', () => {
  let service: TenantsService;
  let provisionerQueueMock: any;
  let prismaMock: any;
  let redisClientMock: any;

  beforeEach(async () => {
    redisClientMock = { del: jest.fn() };
    provisionerQueueMock = { add: jest.fn(), client: Promise.resolve(redisClientMock) };
    
    let dbPlan = 'pro';
    prismaMock = {
      billingPlan: { findUnique: jest.fn().mockResolvedValue({ slug: 'enterprise' }) },
      tenant: {
        findUnique: jest.fn().mockImplementation(() => ({ id: 't1', plan: dbPlan, dataIsolationOverridden: false })),
        update: jest.fn().mockImplementation(({ data }) => {
          dbPlan = data.plan;
          return { id: 't1', plan: data.plan, graceEndsAt: data.graceEndsAt };
        }),
      },
      tenantDataPlane: { upsert: jest.fn().mockResolvedValue({ generation: 1 }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EntitlementsService, useValue: { bust: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: TenantLifecycleService, useValue: {} },
        { provide: getQueueToken('provisioner'), useValue: provisionerQueueMock },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
  });

  it('handles upgrade: enqueues reconcile-plan-migration immediately and clears quota_cache', async () => {
    prismaMock.billingPlan.findUnique.mockResolvedValueOnce({ slug: 'enterprise' });
    await service.changePlan('t1', 'enterprise', 'actor1');
    expect(redisClientMock.del).toHaveBeenCalledWith('quota_cache:t1');
    expect(prismaMock.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ plan: 'enterprise', graceEndsAt: null })
    }));
    expect(provisionerQueueMock.add).toHaveBeenCalledWith(
      'reconcile-plan-migration',
      expect.objectContaining({ currentPlan: 'pro', targetPlan: 'enterprise' }),
      expect.objectContaining({ delay: 0 })
    );
  });

  it('handles downgrade: enqueues apply-downgrade-reconciliation with 7 day delay and sets graceEndsAt', async () => {
    prismaMock.billingPlan.findUnique.mockResolvedValueOnce({ slug: 'free' });
    prismaMock.tenant.findUnique.mockImplementation(() => ({ id: 't1', plan: 'pro', dataIsolationOverridden: false }));

    await service.changePlan('t1', 'free', 'actor1');
    expect(redisClientMock.del).toHaveBeenCalledWith('quota_cache:t1');
    
    // Check that graceEndsAt was set (approx 7 days from now)
    const updateCall = prismaMock.tenant.update.mock.calls.find(call => call[0].data.graceEndsAt !== undefined);
    expect(updateCall[0].data.graceEndsAt).not.toBeNull();
    
    expect(provisionerQueueMock.add).toHaveBeenCalledWith(
      'apply-downgrade-reconciliation',
      expect.objectContaining({ currentPlan: 'pro', targetPlan: 'free' }),
      expect.objectContaining({ delay: 7 * 24 * 60 * 60 * 1000 })
    );
  });
});

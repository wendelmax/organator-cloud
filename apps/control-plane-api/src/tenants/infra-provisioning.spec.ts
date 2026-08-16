import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { getQueueToken } from '@nestjs/bullmq';

describe('TenantsService Infra Provisioning', () => {
  let service: TenantsService;
  let provisionerQueueMock: any;
  let prismaMock: any;

  beforeEach(async () => {
    provisionerQueueMock = { add: jest.fn() };
    prismaMock = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1', slug: 'tenant1', plan: 'pro' }) }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EntitlementsService, useValue: {} },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: TenantLifecycleService, useValue: {} },
        { provide: getQueueToken('provisioner'), useValue: provisionerQueueMock },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
  });

  it('enqueues deploy-tenant-infra job in provisionerQueue', async () => {
    const res = await service.triggerInfraProvisioning('t1', 'actor1');
    expect(res.status).toBe('QUEUED');
    expect(res.tenantId).toBe('t1');
    expect(provisionerQueueMock.add).toHaveBeenCalledWith(
      'deploy-tenant-infra',
      expect.objectContaining({
        tenantId: 't1',
        slug: 'tenant1',
        plan: 'pro',
        actorId: 'actor1',
      }),
      expect.any(Object),
    );
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { getQueueToken } from '@nestjs/bullmq';

describe('Tenant Environments & Health', () => {
  let service: TenantsService;
  let controller: TenantsController;
  let provisionerQueueMock: any;
  let prismaMock: any;

  beforeEach(async () => {
    provisionerQueueMock = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    
    prismaMock = {
      tenantEnvironment: { findMany: jest.fn().mockResolvedValue([{ id: 'env-1' }]), upsert: jest.fn().mockResolvedValue({ id: 'env-1' }) },
      tenantHealth: { findFirst: jest.fn().mockResolvedValue({ status: 'HEALTHY' }) },
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 't-1' }]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EntitlementsService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: TenantLifecycleService, useValue: {} },
        { provide: getQueueToken('provisioner'), useValue: provisionerQueueMock },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    controller = module.get<TenantsController>(TenantsController);
  });

  it('lists environments', async () => {
    const res = await controller.getEnvironments('t-1');
    expect(res).toEqual([{ id: 'env-1' }]);
    expect(prismaMock.tenantEnvironment.findMany).toHaveBeenCalledWith({ where: { tenantId: 't-1' } });
  });

  it('upserts environment', async () => {
    const res = await controller.upsertEnvironment('t-1', { type: 'STAGING' });
    expect(res).toEqual({ id: 'env-1' });
    expect(prismaMock.tenantEnvironment.upsert).toHaveBeenCalled();
  });

  it('triggers promote environment', async () => {
    const res = await controller.promoteEnvironment('t-1', { sourceEnvId: 'env-1' });
    expect(res).toEqual({ jobId: 'job-1', status: 'QUEUED' });
    expect(provisionerQueueMock.add).toHaveBeenCalledWith('promote-tenant-environment', { tenantId: 't-1', sourceEnvId: 'env-1' });
  });

  it('gets tenant health', async () => {
    const res = await controller.getTenantHealth('t-1');
    expect(res).toEqual({ status: 'HEALTHY' });
    expect(prismaMock.tenantHealth.findFirst).toHaveBeenCalledWith({ where: { tenantId: 't-1' }, orderBy: { checkedAt: 'desc' } });
  });

  it('gets health summary', async () => {
    const res = await controller.getHealthSummary();
    expect(res).toEqual([{ tenant: { id: 't-1' }, health: { status: 'HEALTHY' } }]);
  });
});

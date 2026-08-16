import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { getQueueToken } from '@nestjs/bullmq';

describe('Tenant Lifecycle Actions', () => {
  let service: TenantsService;
  let controller: TenantsController;
  let provisionerQueueMock: any;
  let prismaMock: any;

  beforeEach(async () => {
    provisionerQueueMock = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    
    prismaMock = {
      tenantBackup: { findMany: jest.fn().mockResolvedValue([{ id: 'b-1' }]) },
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

  it('triggers backup', async () => {
    const res = await controller.triggerBackup('t-1');
    expect(res).toEqual({ jobId: 'job-1', status: 'QUEUED' });
    expect(provisionerQueueMock.add).toHaveBeenCalledWith('backup-tenant-infra', { tenantId: 't-1' });
  });

  it('lists backups', async () => {
    const res = await controller.getBackups('t-1');
    expect(res).toEqual([{ id: 'b-1' }]);
    expect(prismaMock.tenantBackup.findMany).toHaveBeenCalledWith({ where: { tenantId: 't-1' } });
  });

  it('triggers restore', async () => {
    const res = await controller.triggerRestore('t-1', { backupId: 'b-1' });
    expect(res).toEqual({ jobId: 'job-1', status: 'QUEUED' });
    expect(provisionerQueueMock.add).toHaveBeenCalledWith('restore-tenant-infra', { tenantId: 't-1', backupId: 'b-1' });
  });

  it('triggers clone', async () => {
    const res = await controller.triggerClone('t-1', { targetSlug: 's2', targetName: 'n2' });
    expect(res).toEqual({ jobId: 'job-1', status: 'QUEUED' });
    expect(provisionerQueueMock.add).toHaveBeenCalledWith('clone-tenant-environment', { tenantId: 't-1', targetSlug: 's2', targetName: 'n2' });
  });

  it('triggers offboard', async () => {
    const res = await controller.triggerOffboard('t-1');
    expect(res).toEqual({ jobId: 'job-1', status: 'QUEUED' });
    expect(provisionerQueueMock.add).toHaveBeenCalledWith('offboard-tenant-infra', { tenantId: 't-1' });
  });
});

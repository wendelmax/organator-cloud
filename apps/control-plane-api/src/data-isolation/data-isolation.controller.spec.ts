import { Test } from '@nestjs/testing';
import { DataIsolationController } from './data-isolation.controller';
import { DataIsolationService } from './data-isolation.service';

describe('DataIsolationController', () => {
  let controller: DataIsolationController;
  let service: any;

  beforeEach(async () => {
    service = {
      getStatus: jest.fn(),
      setOverride: jest.fn(),
      reconcile: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [DataIsolationController],
      providers: [{ provide: DataIsolationService, useValue: service }],
    }).compile();

    controller = module.get(DataIsolationController);
  });

  it('getStatus uses tenant from JWT context', async () => {
    const req = { user: { tenantId: 'tenant-1', role: 'OWNER' } };
    service.getStatus.mockResolvedValue({ tenantId: 'tenant-1', desiredMode: 'SHARED' });
    const result = await controller.getStatus(req);
    expect(service.getStatus).toHaveBeenCalledWith('tenant-1');
    expect(result.tenantId).toBe('tenant-1');
  });

  it('setOverride passes tenantId from path param', async () => {
    const req = { user: { userId: 'admin-1', role: 'PLATFORM_ADMIN' } };
    service.setOverride.mockResolvedValue({ desiredMode: 'DATABASE' });
    await controller.setOverride('tenant-1', { mode: 'DATABASE' }, req);
    expect(service.setOverride).toHaveBeenCalledWith('tenant-1', { mode: 'DATABASE' }, 'admin-1');
  });

  it('reconcile passes tenantId and actorId', async () => {
    const req = { user: { userId: 'admin-1', role: 'PLATFORM_ADMIN' } };
    service.reconcile.mockResolvedValue({ generation: 5 });
    await controller.reconcile('tenant-1', req);
    expect(service.reconcile).toHaveBeenCalledWith('tenant-1', 'admin-1');
  });
});

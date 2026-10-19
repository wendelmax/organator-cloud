import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';

describe('StatusController', () => {
  let controller: StatusController;
  let svc: jest.Mocked<StatusService>;

  beforeEach(() => {
    svc = { getStatus: jest.fn() } as any;
    controller = new StatusController(svc);
  });

  it('exposes GET /v1/status as public (no guards applied)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, StatusController);
    expect(guards).toBeUndefined();
    const methodGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- leitura de metadados; não há execução do método aqui
      StatusController.prototype.status,
    );
    expect(methodGuards).toBeUndefined();
  });

  it('returns aggregated status', async () => {
    const payload = {
      overall: 'operational' as const,
      components: [
        {
          component: 'api' as const,
          status: 'operational' as const,
          activeIncidents: 0,
        },
        {
          component: 'dashboard' as const,
          status: 'operational' as const,
          activeIncidents: 0,
        },
        {
          component: 'provisioning' as const,
          status: 'operational' as const,
          activeIncidents: 0,
        },
        {
          component: 'billing' as const,
          status: 'operational' as const,
          activeIncidents: 0,
        },
        {
          component: 'data-plane' as const,
          status: 'operational' as const,
          activeIncidents: 0,
        },
      ],
      incidents: [],
    };
    svc.getStatus.mockResolvedValue(payload);
    await expect(controller.status()).resolves.toEqual(payload);
  });
});

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { DomainsController } from '../domains/domains.controller';
import { ProvisioningController } from '../onboarding/provisioning.controller';
import { PrismaService } from '../prisma/prisma.service';

const req = { user: { userId: 'u1', tenantId: 't1' }, query: { microserviceId: 'svc-1' } };

describe('DomainsController', () => {
  it('scopes every route to the caller tenant', async () => {
    const svc = { create: jest.fn(), list: jest.fn(), validate: jest.fn(), remove: jest.fn() };
    const controller = new DomainsController(svc as any);
    const body = { hostname: 'app.acme.com', provider: 'route53' };

    controller.create(req, body);
    controller.list(req);
    controller.validate(req, 'd1');
    controller.remove(req, 'd1');

    expect(svc.create).toHaveBeenCalledWith('t1', body, 'u1');
    expect(svc.list).toHaveBeenCalledWith('t1', 'svc-1');
    expect(svc.validate).toHaveBeenCalledWith('t1', 'd1');
    expect(svc.remove).toHaveBeenCalledWith('t1', 'd1', 'u1');
    expect(Reflect.getMetadata(GUARDS_METADATA, DomainsController)).toEqual([JwtAuthGuard]);
  });
});

describe('ProvisioningController', () => {
  it('is restricted to tenant admins and uses the caller tenant', async () => {
    const svc = { provision: jest.fn(), deprovision: jest.fn() };
    const controller = new ProvisioningController(svc as any);

    controller.provision(req);
    controller.deprovision(req);

    expect(svc.provision).toHaveBeenCalledWith('t1', 'u1');
    expect(svc.deprovision).toHaveBeenCalledWith('t1', 'u1');
    expect(Reflect.getMetadata(GUARDS_METADATA, ProvisioningController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, ProvisioningController)).toEqual(['OWNER', 'ADMIN', 'PLATFORM_ADMIN']);
  });
});

describe('PrismaService', () => {
  it('connects on module init and disconnects on destroy', async () => {
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined as never);
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined as never);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

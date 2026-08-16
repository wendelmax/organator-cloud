import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { getQueueToken } from '@nestjs/bullmq';

describe('Telemetry & Rollout API', () => {
  let service: TenantsService;
  let controller: TenantsController;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      providerCircuitBreaker: {
        findMany: jest.fn().mockResolvedValue([{ provider: 'AWS', state: 'CLOSED' }]),
        upsert: jest.fn().mockResolvedValue({ provider: 'AWS', state: 'CLOSED' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EntitlementsService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: TenantLifecycleService, useValue: {} },
        { provide: getQueueToken('provisioner'), useValue: {} },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    controller = module.get<TenantsController>(TenantsController);
  });

  it('gets provisioner telemetry', async () => {
    const res = await controller.getProvisionerTelemetry();
    expect(res.circuitBreakers).toEqual([{ provider: 'AWS', state: 'CLOSED' }]);
    expect(prismaMock.providerCircuitBreaker.findMany).toHaveBeenCalled();
  });

  it('resets circuit breaker', async () => {
    const res = await controller.resetCircuitBreaker({ provider: 'AWS' });
    expect(res).toEqual({ provider: 'AWS', state: 'CLOSED' });
    expect(prismaMock.providerCircuitBreaker.upsert).toHaveBeenCalled();
  });
});

import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { QuotaGuard } from './quota.guard';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

describe('QuotaGuard', () => {
  let guard: QuotaGuard;
  let reflector: Reflector;
  let entitlementsService: EntitlementsService;
  let prismaService: PrismaService;

  const mockEntitlementsService = {
    checkQuota: jest.fn(),
  };

  const mockPrismaService = {
    microservice: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(() => {
    reflector = new Reflector();
    entitlementsService =
      mockEntitlementsService as unknown as EntitlementsService;
    prismaService = mockPrismaService as unknown as PrismaService;
    guard = new QuotaGuard(reflector, entitlementsService, prismaService);
    jest.clearAllMocks();
  });

  function createMockContext(req: any): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  }

  it('should return true if no quota decorator is present', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({});

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockEntitlementsService.checkQuota).not.toHaveBeenCalled();
  });

  it('should extract tenantId from req.user and call checkQuota', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('MICROSERVICE');
    const context = createMockContext({
      user: { tenantId: 'tenant-123' },
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockEntitlementsService.checkQuota).toHaveBeenCalledWith(
      'tenant-123',
      'MICROSERVICE',
    );
  });

  it('should extract tenantId from req.body if not in user', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('MICROSERVICE');
    const context = createMockContext({
      body: { tenantId: 'tenant-456' },
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockEntitlementsService.checkQuota).toHaveBeenCalledWith(
      'tenant-456',
      'MICROSERVICE',
    );
  });

  it('should resolve tenantId from microservice id in req.params if not present in req.user/body', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('DEPLOYMENT');
    mockPrismaService.microservice.findUnique.mockResolvedValue({
      id: 'svc-789',
      tenantId: 'tenant-789',
    });

    const context = createMockContext({
      params: { id: 'svc-789' },
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockPrismaService.microservice.findUnique).toHaveBeenCalledWith({
      where: { id: 'svc-789' },
      select: { tenantId: true },
    });
    expect(mockEntitlementsService.checkQuota).toHaveBeenCalledWith(
      'tenant-789',
      'DEPLOYMENT',
    );
  });
});

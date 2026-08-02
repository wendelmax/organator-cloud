import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { FeatureGuard } from './feature.guard';
import { EntitlementsService } from './entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FeatureGuard', () => {
  let guard: FeatureGuard;
  let reflector: Reflector;
  let entitlementsService: EntitlementsService;
  let prismaService: PrismaService;

  const mockEntitlementsService = {
    requireFeature: jest.fn(),
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
    guard = new FeatureGuard(reflector, entitlementsService, prismaService);
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

  it('returns true when no feature decorator is present', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({});

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockEntitlementsService.requireFeature).not.toHaveBeenCalled();
  });

  it('requires the feature from req.user.tenantId', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('api_keys');
    const context = createMockContext({
      user: { tenantId: 'tenant-123' },
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockEntitlementsService.requireFeature).toHaveBeenCalledWith(
      'tenant-123',
      'api_keys',
    );
  });

  it('resolves tenantId from microservice id in req.params', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('sso_saml');
    mockPrismaService.microservice.findUnique.mockResolvedValue({
      id: 'svc-1',
      tenantId: 'tenant-999',
    });

    const context = createMockContext({
      params: { id: 'svc-1' },
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockEntitlementsService.requireFeature).toHaveBeenCalledWith(
      'tenant-999',
      'sso_saml',
    );
  });

  it('skips the check when no tenantId can be extracted', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('api_keys');
    mockPrismaService.microservice.findUnique.mockResolvedValue(null);

    const context = createMockContext({ params: { id: 'svc-1' } });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(mockEntitlementsService.requireFeature).not.toHaveBeenCalled();
  });
});

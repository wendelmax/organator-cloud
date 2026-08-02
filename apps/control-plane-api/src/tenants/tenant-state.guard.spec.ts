import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { TenantStateGuard } from './tenant-state.guard';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { ApiKeysService } from '../api-keys/api-keys.service';

describe('TenantStateGuard', () => {
  let guard: TenantStateGuard;

  const mockJwt = { verify: jest.fn() };
  const mockLifecycle = { assertAccess: jest.fn() };
  const mockApiKeys = { resolveTenantId: jest.fn() };

  const makeReq = (url: string, method = 'GET', token?: string | null) => ({
    url,
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantStateGuard,
        { provide: JwtService, useValue: mockJwt },
        { provide: TenantLifecycleService, useValue: mockLifecycle },
        { provide: ApiKeysService, useValue: mockApiKeys },
      ],
    }).compile();

    guard = module.get<TenantStateGuard>(TenantStateGuard);
  });

  it('should skip public paths', async () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => makeReq('/v1/onboarding/webhook', 'POST', 'token'),
      }),
    } as any;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockLifecycle.assertAccess).not.toHaveBeenCalled();
  });

  it('should allow requests without token (auth guard decides)', async () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => makeReq('/v1/microservices', 'GET'),
      }),
    } as any;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockLifecycle.assertAccess).not.toHaveBeenCalled();
  });

  it('should allow requests with invalid token (auth guard rejects)', async () => {
    mockJwt.verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => makeReq('/v1/microservices', 'GET', 'bad'),
      }),
    } as any;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockLifecycle.assertAccess).not.toHaveBeenCalled();
  });

  it('should allow platform users without tenant', async () => {
    mockJwt.verify.mockReturnValue({ sub: 'u1', role: 'PLATFORM_ADMIN' });
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => makeReq('/v1/tenants', 'GET', 'token'),
      }),
    } as any;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockLifecycle.assertAccess).not.toHaveBeenCalled();
  });

  it('should enforce state access for tenant users', async () => {
    mockJwt.verify.mockReturnValue({ sub: 'u1', tenantId: 't1' });
    mockLifecycle.assertAccess.mockResolvedValue(undefined);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => makeReq('/v1/microservices', 'POST', 'token'),
      }),
    } as any;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockLifecycle.assertAccess).toHaveBeenCalledWith('t1', 'POST');
  });

  it('should enforce state access for API key tokens', async () => {
    mockApiKeys.resolveTenantId.mockResolvedValue('t1');
    mockLifecycle.assertAccess.mockResolvedValue(undefined);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => makeReq('/v1/services', 'POST', 'sk_deadbeef'),
      }),
    } as any;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockLifecycle.assertAccess).toHaveBeenCalledWith('t1', 'POST');
  });

  it('should skip state enforcement for invalid API key', async () => {
    mockApiKeys.resolveTenantId.mockResolvedValue(null);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => makeReq('/v1/services', 'GET', 'sk_deadbeef'),
      }),
    } as any;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockLifecycle.assertAccess).not.toHaveBeenCalled();
  });

  it('should propagate block from lifecycle (suspended)', async () => {
    mockJwt.verify.mockReturnValue({ sub: 'u1', tenantId: 't1' });
    mockLifecycle.assertAccess.mockRejectedValue(new Error('TENANT_SUSPENDED'));
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => makeReq('/v1/microservices', 'GET', 'token'),
      }),
    } as any;

    await expect(guard.canActivate(ctx)).rejects.toThrow('TENANT_SUSPENDED');
  });
});

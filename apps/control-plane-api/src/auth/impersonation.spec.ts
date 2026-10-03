import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthController } from './auth.controller';
import {
  ImpersonationService,
  IMPERSONATION_MINUTES,
} from './impersonation.service';
import {
  ImpersonationInterceptor,
  isBlockedForImpersonation,
} from './impersonation.interceptor';
import { JwtStrategy } from './jwt.strategy';

const admin = {
  userId: 'admin-1',
  email: 'ops@organator.app',
  role: 'PLATFORM_ADMIN',
};

describe('ImpersonationService', () => {
  let prisma: any;
  let jwt: { sign: jest.Mock };
  let audit: { record: jest.Mock };
  let service: ImpersonationService;
  const target = {
    id: 'u1',
    email: 'maria@acme.com',
    role: 'MEMBER',
    tenantId: 't1',
    tenant: { state: 'active' },
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(target) },
      userSession: {
        create: jest.fn(({ data }) =>
          Promise.resolve({ id: 'sess-imp', ...data }),
        ),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    jwt = { sign: jest.fn().mockReturnValue('jwt-imp') };
    audit = { record: jest.fn() };
    service = new ImpersonationService(prisma, jwt as any, audit as any);
  });

  it('opens a short, marked session as the user and audits who, whom and why', async () => {
    const before = Date.now();
    const result = await service.start(
      admin,
      { userId: 'u1', reason: 'Ticket #42: erro no deploy' },
      { ip: '10.0.0.1' },
    );

    expect(result).toMatchObject({
      access_token: 'jwt-imp',
      user: {
        id: 'u1',
        email: 'maria@acme.com',
        role: 'MEMBER',
        tenantId: 't1',
      },
    });
    const { data } = prisma.userSession.create.mock.calls[0][0];
    expect(data).toMatchObject({
      userId: 'u1',
      tenantId: 't1',
      role: 'MEMBER',
      impersonatorId: 'admin-1',
      impersonatorEmail: 'ops@organator.app',
      impersonationReason: 'Ticket #42: erro no deploy',
    });
    const ttl = data.expiresAt.getTime() - before;
    expect(ttl).toBeLessThanOrEqual(IMPERSONATION_MINUTES * 60_000 + 1000);
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u1',
        sessionId: 'sess-imp',
        impersonator: 'admin-1',
      }),
      { expiresIn: '30m' },
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.impersonation_started',
        actorId: 'admin-1',
        resourceId: 'u1',
        changes: expect.objectContaining({
          reason: 'Ticket #42: erro no deploy',
        }),
      }),
    );
  });

  it.each([
    [
      'another platform admin',
      { ...target, role: 'PLATFORM_ADMIN' },
      ForbiddenException,
    ],
    [
      'a user of an offboarded tenant',
      { ...target, tenant: { state: 'offboarding' } },
      ForbiddenException,
    ],
    ['an unknown user', null, NotFoundException],
  ])('never impersonates %s', async (_label, found, error) => {
    prisma.user.findUnique.mockResolvedValue(found);
    await expect(
      service.start(admin, { userId: 'u1', reason: 'Ticket #42' }),
    ).rejects.toThrow(error);
    expect(prisma.userSession.create).not.toHaveBeenCalled();
  });

  it('requires a platform admin in their own session and a reason', async () => {
    await expect(
      service.start(
        { ...admin, role: 'OWNER' },
        { userId: 'u1', reason: 'Ticket #42' },
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.start(
        { ...admin, impersonatorId: 'x' },
        { userId: 'u1', reason: 'Ticket #42' },
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.start(admin, { userId: 'u1', reason: 'oi' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.start(admin, { userId: 'admin-1', reason: 'Ticket #42' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('ends the session: revokes it and audits the duration', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      createdAt: new Date(Date.now() - 90_000),
    });
    const result = await service.stop({
      userId: 'u1',
      sessionId: 'sess-imp',
      impersonatorId: 'admin-1',
    });

    expect(prisma.userSession.update).toHaveBeenCalledWith({
      where: { id: 'sess-imp' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result.durationSeconds).toBeGreaterThanOrEqual(90);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.impersonation_ended',
        actorId: 'admin-1',
      }),
    );
    await expect(
      service.stop({ userId: 'u1', sessionId: 's' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lets SUPPORT start it too, but never on platform staff', async () => {
    const support = {
      userId: 'sup-1',
      email: 'help@organator.app',
      role: 'SUPPORT',
    };
    await expect(
      service.start(support, { userId: 'u1', reason: 'Ticket #42' }),
    ).resolves.toMatchObject({ access_token: 'jwt-imp' });

    prisma.user.findUnique.mockResolvedValue({ ...target, role: 'SUPPORT' });
    await expect(
      service.start(admin, { userId: 'u1', reason: 'Ticket #42' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires an authenticated session on the route (role checked in the service)', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        (AuthController.prototype as any).impersonate,
      ),
    ).toEqual([JwtAuthGuard]);
  });
});

describe('ImpersonationInterceptor', () => {
  let audit: { record: jest.Mock };
  let interceptor: ImpersonationInterceptor;

  const ctx = (method: string, url: string, user: any, statusCode = 200) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method, url, user, ip: '10.0.0.1' }),
        getResponse: () => ({ statusCode }),
      }),
    }) as unknown as ExecutionContext;
  const handler = (result: unknown = { ok: true }): CallHandler => ({
    handle: () => of(result),
  });
  const impersonated = {
    userId: 'u1',
    sessionId: 'sess-imp',
    impersonatorId: 'admin-1',
  };

  beforeEach(() => {
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    interceptor = new ImpersonationInterceptor(audit as any);
  });

  it('records every request of a support session, reads included', async () => {
    await lastValueFrom(
      interceptor.intercept(
        ctx('GET', '/v1/services/tenant/t1?x=1', impersonated),
        handler(),
      ),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.impersonated_request',
        actorId: 'admin-1',
        resourceId: 'u1',
        changes: {
          method: 'GET',
          path: '/v1/services/tenant/t1',
          status: 200,
          sessionId: 'sess-imp',
        },
      }),
    );
  });

  it('records failed requests with their status', async () => {
    const failing: CallHandler = {
      handle: () =>
        throwError(() => Object.assign(new Error('nope'), { status: 404 })),
    };
    await expect(
      lastValueFrom(
        interceptor.intercept(
          ctx('POST', '/v1/services', impersonated),
          failing,
        ),
      ),
    ).rejects.toThrow('nope');
    expect(audit.record.mock.calls[0][0].changes.status).toBe(404);
  });

  it.each([
    ['POST', '/v1/auth/change-password'],
    ['POST', '/v1/auth/mfa/disable'],
    ['DELETE', '/v1/auth/sessions/s1'],
    ['POST', '/v1/auth/switch-tenant'],
    ['POST', '/v1/auth/impersonate'],
    ['POST', '/v1/api-keys'],
    ['POST', '/v1/compliance/erasure'],
    ['GET', '/v1/compliance/exports/e1/download'],
    ['PUT', '/v1/tenants/current/password-policy'],
  ])(
    'blocks %s %s in a support session and records the attempt',
    (method, path) => {
      expect(() =>
        interceptor.intercept(ctx(method, path, impersonated), handler()),
      ).toThrow(ForbiddenException);
      expect(audit.record.mock.calls[0][0].changes.status).toBe(403);
    },
  );

  it('allows ending the support session and leaves normal sessions alone', async () => {
    expect(isBlockedForImpersonation('POST', '/v1/auth/impersonate/stop')).toBe(
      false,
    );
    await lastValueFrom(
      interceptor.intercept(
        ctx('POST', '/v1/auth/change-password', { userId: 'u1' }),
        handler(),
      ),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('JwtStrategy — support sessions', () => {
  it('exposes who is impersonating', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'maria@acme.com',
          role: 'MEMBER',
          tenantId: 't1',
          tenant: { state: 'active' },
        }),
      },
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sess-imp',
          tenantId: 't1',
          role: 'MEMBER',
          impersonatorId: 'admin-1',
          impersonatorEmail: 'ops@organator.app',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const user = await new JwtStrategy(prisma).validate({
      sub: 'u1',
      sessionId: 'sess-imp',
    });
    expect(user).toMatchObject({
      userId: 'u1',
      impersonatorId: 'admin-1',
      impersonatorEmail: 'ops@organator.app',
    });
  });
});

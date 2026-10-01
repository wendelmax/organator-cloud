import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard, IS_PUBLIC_KEY } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let reflector: Reflector;
  let guard: JwtAuthGuard;
  let parentCanActivate: jest.SpyInstance;

  const ctx = (user: any) =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  const withMetadata = (meta: Record<string, boolean>) =>
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) => meta[key]);

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
    const Parent = Object.getPrototypeOf(JwtAuthGuard.prototype);
    parentCanActivate = jest
      .spyOn(Parent, 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips authentication on @Public routes', async () => {
    withMetadata({ [IS_PUBLIC_KEY]: true });
    await expect(guard.canActivate(ctx(undefined))).resolves.toBe(true);
    expect(parentCanActivate).not.toHaveBeenCalled();
  });

  it('returns false when passport does not authenticate', async () => {
    withMetadata({});
    parentCanActivate.mockResolvedValue(false);
    await expect(guard.canActivate(ctx(undefined))).resolves.toBe(false);
  });

  it('allows authenticated users', async () => {
    withMetadata({});
    await expect(guard.canActivate(ctx({ userId: 'u1' }))).resolves.toBe(true);
  });

  it('blocks users that must change their password', async () => {
    withMetadata({});
    const promise = guard.canActivate(
      ctx({ userId: 'u1', mustChangePassword: true }),
    );
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(ctx({ mustChangePassword: true })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MUST_CHANGE_PASSWORD' }),
    });
  });

  it('lets them through on @AllowPasswordChange routes', async () => {
    withMetadata({ allowPasswordChange: true });
    await expect(
      guard.canActivate(ctx({ mustChangePassword: true })),
    ).resolves.toBe(true);
  });
});

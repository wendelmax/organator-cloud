import { AuthService } from './auth.service';
import * as bcrypt from 'bcrypt';

describe('AuthService MFA gate', () => {
  it('returns a challenge without a JWT when tenant policy requires MFA', async () => {
    const mfa = {
      createChallenge: jest
        .fn()
        .mockResolvedValue({ challenge_token: 'opaque', expires_at: 'later' }),
    };
    const policy = { requiresMfa: jest.fn().mockResolvedValue(true) };
    const service = new AuthService(
      {} as never,
      { sign: jest.fn() } as never,
      mfa as never,
      policy as never,
    );
    const result = await service.login({
      id: 'u1',
      email: 'u@example.com',
      role: 'OWNER',
      tenantId: 't1',
    });
    expect(result).toMatchObject({
      mfa_required: true,
      challenge_token: 'opaque',
    });
    expect(result).not.toHaveProperty('access_token');
  });
});

describe('AuthService session policy', () => {
  it('evicts the oldest session when the concurrent limit is reached', async () => {
    const prisma: any = {
      userSession: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'oldest' },
            { id: 's2' },
            { id: 's3' },
            { id: 's4' },
            { id: 'newer' },
          ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'current' }),
      },
    };
    const service = new AuthService(
      prisma,
      { sign: jest.fn().mockReturnValue('jwt') } as never,
      {} as never,
      { requiresMfa: jest.fn().mockResolvedValue(false) } as never,
    );

    await service.login({
      id: 'u1',
      email: 'u@example.com',
      role: 'OWNER',
      tenantId: 't1',
    });

    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['oldest'] } },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokes every other active session after password change', async () => {
    const passwordHash = await bcrypt.hash('old', 4);
    const prisma: any = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'u1', password: passwordHash }),
        update: jest.fn().mockResolvedValue({}),
      },
      userSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const service = new AuthService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.changePassword(
      'u1',
      'old',
      'new-password',
      'current-session',
    );

    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', id: { not: 'current-session' }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('refreshes an access token only for an active persisted session', async () => {
    const prisma: any = {
      userSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1',
          userId: 'u1',
          tenantId: 't2',
          role: 'ADMIN',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: {
            email: 'u@example.com',
            tenantId: 't1',
            role: 'MEMBER',
            mustChangePassword: false,
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const jwt = { sign: jest.fn().mockReturnValue('new-jwt') };
    const service = new AuthService(
      prisma,
      jwt as never,
      {} as never,
      {} as never,
    );

    await expect(service.refresh('raw-refresh-token')).resolves.toEqual({
      access_token: 'new-jwt',
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u1',
        tenantId: 't2',
        role: 'ADMIN',
        sessionId: 's1',
      }),
    );
  });
});

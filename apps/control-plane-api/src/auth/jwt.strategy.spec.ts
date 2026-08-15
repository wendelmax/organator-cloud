import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy tenant session context', () => {
  it('uses the tenant and role persisted in the active switched session', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'owner@example.com',
          tenantId: 'tenant-home',
          role: 'OWNER',
          mustChangePassword: false,
          authProvider: 'local',
          tenant: { status: 'active', state: 'active' },
        }),
      },
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-2',
          userId: 'user-1',
          tenantId: 'tenant-shared',
          role: 'ADMIN',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const strategy = new JwtStrategy(prisma);

    const result = await strategy.validate({
      sub: 'user-1',
      sessionId: 'session-2',
    });

    expect(result).toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-shared',
      role: 'ADMIN',
      sessionId: 'session-2',
    });
  });
});

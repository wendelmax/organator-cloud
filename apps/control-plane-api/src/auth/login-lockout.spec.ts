jest.mock('bcrypt', () => ({
  compare: jest.fn(
    async (plain: string, hash: string) => hash === `hash:${plain}`,
  ),
  hash: jest.fn(async (plain: string) => `hash:${plain}`),
}));

import * as bcrypt from 'bcrypt';
import { AuthService, loginLockoutPolicy } from './auth.service';

describe('AuthService — login lockout and enumeration resistance', () => {
  const originalEnv = { ...process.env };
  let prisma: any;
  let user: any;
  let service: AuthService;

  beforeEach(() => {
    delete process.env.LOGIN_MAX_FAILED_ATTEMPTS;
    delete process.env.LOGIN_LOCKOUT_MINUTES;
    (bcrypt.compare as jest.Mock).mockClear();
    user = {
      id: 'u1',
      email: 'o@acme.com',
      password: 'hash:correct-horse',
      tenantId: 't1',
      failedLoginAttempts: 0,
      loginLockedUntil: null,
    };
    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }) =>
          where.email === user.email ? { ...user } : null,
        ),
        update: jest.fn(async ({ data, select }) => {
          if (data.failedLoginAttempts?.increment) {
            user.failedLoginAttempts += data.failedLoginAttempts.increment;
          } else {
            Object.assign(user, data);
          }
          return select
            ? { failedLoginAttempts: user.failedLoginAttempts }
            : user;
        }),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ state: 'active' }) },
    };
    service = new AuthService(prisma, {} as any, {} as any, {} as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to 5 attempts and 15 minutes, configurable via env', () => {
    expect(loginLockoutPolicy({})).toEqual({
      maxAttempts: 5,
      lockoutMinutes: 15,
    });
    expect(
      loginLockoutPolicy({
        LOGIN_MAX_FAILED_ATTEMPTS: '3',
        LOGIN_LOCKOUT_MINUTES: '60',
      }),
    ).toEqual({
      maxAttempts: 3,
      lockoutMinutes: 60,
    });
    expect(
      loginLockoutPolicy({
        LOGIN_MAX_FAILED_ATTEMPTS: '0',
        LOGIN_LOCKOUT_MINUTES: 'x',
      }),
    ).toEqual({
      maxAttempts: 5,
      lockoutMinutes: 15,
    });
  });

  it('counts consecutive failures and locks the account on the 5th', async () => {
    for (let i = 1; i <= 4; i++) {
      await expect(
        service.validateUser(user.email, 'wrong'),
      ).resolves.toBeNull();
      expect(user.failedLoginAttempts).toBe(i);
      expect(user.loginLockedUntil).toBeNull();
    }
    await service.validateUser(user.email, 'wrong');
    expect(user.failedLoginAttempts).toBe(0);
    const minutes = (user.loginLockedUntil.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it('rejects even the correct password while locked, without checking it', async () => {
    user.loginLockedUntil = new Date(Date.now() + 60_000);
    await expect(
      service.validateUser(user.email, 'correct-horse'),
    ).resolves.toBeNull();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('allows login again once the lock expires and resets the counters', async () => {
    user.loginLockedUntil = new Date(Date.now() - 1000);
    user.failedLoginAttempts = 2;
    await expect(
      service.validateUser(user.email, 'correct-horse'),
    ).resolves.toMatchObject({ id: 'u1' });
    expect(user).toMatchObject({
      failedLoginAttempts: 0,
      loginLockedUntil: null,
    });
  });

  it('does not write on successful logins without prior failures', async () => {
    await service.validateUser(user.email, 'correct-horse');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('spends a bcrypt comparison for unknown e-mails (no timing oracle)', async () => {
    await expect(
      service.validateUser('nobody@acme.com', 'whatever'),
    ).resolves.toBeNull();
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    const [, hash] = (bcrypt.compare as jest.Mock).mock.calls[0];
    expect(hash).toMatch(/^\$2b\$10\$.{53}$/);
  });

  it('honors a custom threshold', async () => {
    process.env.LOGIN_MAX_FAILED_ATTEMPTS = '2';
    await service.validateUser(user.email, 'wrong');
    expect(user.loginLockedUntil).toBeNull();
    await service.validateUser(user.email, 'wrong');
    expect(user.loginLockedUntil).toBeInstanceOf(Date);
  });

  describe('with a tenant password policy', () => {
    let policy: any;

    beforeEach(() => {
      policy = {
        getPolicy: jest.fn().mockResolvedValue({ expiresAfterDays: 30 }),
        isExpired: jest.fn().mockReturnValue(false),
        lockoutFor: jest
          .fn()
          .mockResolvedValue({ maxAttempts: 2, lockoutMinutes: 60 }),
      };
      service = new AuthService(
        prisma,
        {} as any,
        {} as any,
        {} as any,
        policy,
      );
    });

    it('locks the account after the tenant limit, for the tenant duration', async () => {
      await service.validateUser('o@acme.com', 'wrong');
      expect(user.loginLockedUntil).toBeNull();
      const before = Date.now();
      await service.validateUser('o@acme.com', 'wrong');

      expect(policy.lockoutFor).toHaveBeenCalledWith('t1');
      const lockedMs = user.loginLockedUntil.getTime() - before;
      expect(lockedMs).toBeGreaterThan(59 * 60_000);
      expect(lockedMs).toBeLessThanOrEqual(60 * 60_000 + 1_000);
    });

    it('forces a password change when the password expired', async () => {
      policy.isExpired.mockReturnValue(true);

      const result = await service.validateUser('o@acme.com', 'correct-horse');

      expect(result).toMatchObject({ id: 'u1', mustChangePassword: true });
      expect(user.mustChangePassword).toBe(true);
      expect(result.password).toBeUndefined();
    });

    it('does not touch a password that is still valid', async () => {
      const result = await service.validateUser('o@acme.com', 'correct-horse');
      expect(result.mustChangePassword).toBeUndefined();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});

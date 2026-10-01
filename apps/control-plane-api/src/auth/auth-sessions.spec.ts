jest.mock('bcrypt', () => ({
  compare: jest.fn(async (plain: string, hash: string) => hash === `hash:${plain}`),
  hash: jest.fn(async (plain: string) => `hash:${plain}`),
}));

import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('AuthService — credentials, sessions and refresh', () => {
  let prisma: any;
  let jwt: any;
  let mfa: any;
  let mfaPolicy: any;
  let service: AuthService;
  const user = {
    id: 'u1',
    email: 'o@acme.com',
    password: 'hash:correct-horse',
    mfaSecretEncrypted: 'enc',
    tenantId: 't1',
    role: 'OWNER',
    mustChangePassword: false,
    mfaEnabled: false,
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ ...user }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ email: user.email }),
        update: jest.fn().mockResolvedValue({}),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ state: 'active' }) },
      tenantMembership: { findFirst: jest.fn() },
      userSession: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn((args) => Promise.resolve({ id: 'sess-new', ...args.data })),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    jwt = { sign: jest.fn((payload) => `jwt:${JSON.stringify(payload)}`) };
    mfa = { createChallenge: jest.fn().mockResolvedValue({ challenge_token: 'ct', expires_at: 'x' }) };
    mfaPolicy = { requiresMfa: jest.fn().mockResolvedValue(false) };
    service = new AuthService(prisma, jwt, mfa, mfaPolicy);
    delete process.env.MAX_ACTIVE_SESSIONS_PER_USER;
  });

  describe('validateUser', () => {
    it('returns the user without the password hash on match', async () => {
      const result = await service.validateUser(user.email, 'correct-horse');
      expect(result).toMatchObject({ id: 'u1' });
      expect(result).not.toHaveProperty('password');
    });

    it('returns null for wrong password or unknown email', async () => {
      await expect(service.validateUser(user.email, 'nope')).resolves.toBeNull();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.validateUser('x@y.z', 'correct-horse')).resolves.toBeNull();
    });

    it.each(['suspended', 'offboarding', 'deleted'])('blocks login for %s tenants', async (state) => {
      prisma.tenant.findUnique.mockResolvedValue({ state });
      await expect(service.validateUser(user.email, 'correct-horse')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows past_due tenants (grace period)', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ state: 'past_due' });
      await expect(service.validateUser(user.email, 'correct-horse')).resolves.toMatchObject({ id: 'u1' });
    });
  });

  describe('login and session creation', () => {
    it('returns an MFA challenge instead of tokens when policy requires it', async () => {
      mfaPolicy.requiresMfa.mockResolvedValue(true);
      const result: any = await service.login(user);
      expect(result).toMatchObject({ mfa_required: true, challenge_token: 'ct' });
      expect(result).not.toHaveProperty('access_token');
      expect(prisma.userSession.create).not.toHaveBeenCalled();
    });

    it('skips MFA when mfaBypass is set (already verified)', async () => {
      mfaPolicy.requiresMfa.mockResolvedValue(true);
      const result: any = await service.login({ ...user, mfaBypass: true });
      expect(result.access_token).toBeDefined();
    });

    it('stores only the refresh token hash with a 30 day expiry', async () => {
      const result: any = await service.login(user, { ip: '1.1.1.1', userAgent: 'jest' });
      const data = prisma.userSession.create.mock.calls[0][0].data;

      expect(result.refresh_token).toMatch(/^[0-9a-f]{64}$/);
      expect(data.tokenHash).toBe(sha256(result.refresh_token));
      expect(JSON.stringify(data)).not.toContain(result.refresh_token);
      expect(data).toMatchObject({ ip: '1.1.1.1', userAgent: 'jest', tenantId: 't1', role: 'OWNER' });
      const days = (data.expiresAt.getTime() - Date.now()) / 86400000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThanOrEqual(30);
      expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ sub: 'u1', sessionId: 'sess-new' }));
    });

    it('evicts the oldest sessions beyond MAX_ACTIVE_SESSIONS_PER_USER', async () => {
      process.env.MAX_ACTIVE_SESSIONS_PER_USER = '3';
      prisma.userSession.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }]);
      await service.login(user);
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 's2'] } },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('does not evict when under the default limit of 5', async () => {
      prisma.userSession.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      await service.login(user);
      expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const session = (overrides = {}) => ({
      id: 'sess-1',
      userId: 'u1',
      role: null,
      tenantId: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      user: { email: user.email, tenantId: 't1', role: 'OWNER', mustChangePassword: false },
      ...overrides,
    });

    it('requires a token', async () => {
      await expect(service.refresh('')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('looks the session up by token hash and issues a new access token', async () => {
      prisma.userSession.findUnique.mockResolvedValue(session({ role: 'ADMIN', tenantId: 't2' }));
      const result = await service.refresh('raw-token');
      expect(prisma.userSession.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: sha256('raw-token') } }));
      expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ role: 'ADMIN', tenantId: 't2', sessionId: 'sess-1' }));
      expect(result.access_token).toBeDefined();
    });

    it('falls back to the user role/tenant when the session has none', async () => {
      prisma.userSession.findUnique.mockResolvedValue(session());
      await service.refresh('raw');
      expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ role: 'OWNER', tenantId: 't1' }));
    });

    it.each([
      ['unknown', null],
      ['revoked', { revokedAt: new Date() }],
      ['expired', { expiresAt: new Date(Date.now() - 1) }],
    ])('rejects %s sessions', async (_label, overrides) => {
      prisma.userSession.findUnique.mockResolvedValue(overrides === null ? null : session(overrides));
      await expect(service.refresh('raw')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwt.sign).not.toHaveBeenCalled();
    });
  });

  describe('session management', () => {
    it('lists only active sessions without token hashes', async () => {
      await service.listSessions('u1');
      const args = prisma.userSession.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ userId: 'u1', revokedAt: null });
      expect(args.select).not.toHaveProperty('tokenHash');
    });

    it('revokes only sessions owned by the user', async () => {
      prisma.userSession.findFirst.mockResolvedValue(null);
      await expect(service.revokeSession('u1', 'other-user-session')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.userSession.findFirst).toHaveBeenCalledWith({ where: { id: 'other-user-session', userId: 'u1', revokedAt: null } });

      prisma.userSession.findFirst.mockResolvedValue({ id: 's1' });
      await expect(service.revokeSession('u1', 's1')).resolves.toEqual({ revoked: true });
    });

    it('revokes every other session but the current one', async () => {
      prisma.userSession.updateMany.mockResolvedValue({ count: 3 });
      await expect(service.revokeOtherSessions('u1', 'cur')).resolves.toEqual({ revoked: 3 });
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', id: { not: 'cur' }, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  it('me() strips password and MFA secret', async () => {
    const result = await service.me('u1');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('mfaSecretEncrypted');
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.me('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('switchTenant', () => {
    it('requires an active membership', async () => {
      prisma.tenantMembership.findFirst.mockResolvedValue(null);
      await expect(service.switchTenant('u1', 't9')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses suspended tenants', async () => {
      prisma.tenantMembership.findFirst.mockResolvedValue({ role: 'MEMBER', tenant: { state: 'suspended' } });
      await expect(service.switchTenant('u1', 't9')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('issues tokens with the membership role in the target tenant', async () => {
      prisma.tenantMembership.findFirst.mockResolvedValue({ role: 'MEMBER', tenant: { state: 'active' } });
      const result = await service.switchTenant('u1', 't9');
      expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't9', role: 'MEMBER', email: user.email }));
      expect(prisma.userSession.create.mock.calls[0][0].data).toMatchObject({ tenantId: 't9', role: 'MEMBER' });
      expect(result.refresh_token).toBeDefined();
    });
  });

  describe('changePassword', () => {
    it('enforces minimum length and a different password', async () => {
      await expect(service.changePassword('u1', 'correct-horse', 'short')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.changePassword('u1', 'correct-horse-1', 'correct-horse-1')).rejects.toThrow('diferente');
    });

    it('rejects a wrong current password', async () => {
      await expect(service.changePassword('u1', 'wrong', 'new-password-1')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws for unknown users', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.changePassword('x', 'a-password', 'b-password')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hashes the new password, clears mustChangePassword and revokes other sessions', async () => {
      await expect(service.changePassword('u1', 'correct-horse', 'new-password-1', 'cur')).resolves.toMatchObject({ success: true });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { password: 'hash:new-password-1', mustChangePassword: false },
      });
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', id: { not: 'cur' }, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('revokes all sessions when no current session is known', async () => {
      await service.changePassword('u1', 'correct-horse', 'new-password-1');
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});

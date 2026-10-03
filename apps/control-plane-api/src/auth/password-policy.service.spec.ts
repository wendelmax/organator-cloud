import * as bcrypt from 'bcrypt';
import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from './roles.decorator';
import { PasswordPolicyController } from './password-policy.controller';
import {
  DEFAULT_PASSWORD_POLICY,
  PasswordPolicyService,
  policyViolations,
} from './password-policy.service';

describe('policyViolations', () => {
  const strict = {
    ...DEFAULT_PASSWORD_POLICY,
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireDigit: true,
    requireSymbol: true,
  };

  it('lists everything the password is missing', () => {
    expect(policyViolations('short', strict)).toEqual([
      'no mínimo 12 caracteres',
      'uma letra maiúscula',
      'um número',
      'um símbolo',
    ]);
  });

  it('accepts a password that meets the policy', () => {
    expect(policyViolations('Correct-Horse-9', strict)).toEqual([]);
    expect(policyViolations('12345678', DEFAULT_PASSWORD_POLICY)).toEqual([]);
  });
});

describe('PasswordPolicyService', () => {
  const originalEnv = { ...process.env };
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: PasswordPolicyService;

  beforeEach(() => {
    prisma = {
      passwordPolicy: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      passwordHistory: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      user: { findUnique: jest.fn() },
    };
    audit = { record: jest.fn() };
    service = new PasswordPolicyService(prisma, audit as any);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const stored = (rules: Record<string, unknown>) =>
    prisma.passwordPolicy.findUnique.mockResolvedValue({
      tenantId: 't1',
      ...DEFAULT_PASSWORD_POLICY,
      ...rules,
      updatedBy: 'u',
      updatedAt: new Date(),
    });

  it('falls back to the platform defaults without a stored policy', async () => {
    await expect(service.getPolicy('t1')).resolves.toEqual(
      DEFAULT_PASSWORD_POLICY,
    );
    await expect(service.getPolicy(null)).resolves.toEqual(
      DEFAULT_PASSWORD_POLICY,
    );
  });

  describe('updatePolicy', () => {
    it('stores the merged policy and audits from/to', async () => {
      const result = await service.updatePolicy(
        't1',
        { minLength: 12, requireDigit: true, expiresAfterDays: 90 },
        'owner-1',
      );
      expect(result).toMatchObject({
        minLength: 12,
        requireDigit: true,
        expiresAfterDays: 90,
      });
      expect(prisma.passwordPolicy.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1' },
          update: expect.objectContaining({
            minLength: 12,
            updatedBy: 'owner-1',
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.password_policy_updated',
          resourceId: 't1',
          changes: expect.objectContaining({
            from: DEFAULT_PASSWORD_POLICY,
            to: result,
          }),
        }),
      );
    });

    it.each([
      [{ minLength: 4 }],
      [{ minLength: 200 }],
      [{ historySize: 30 }],
      [{ maxFailedAttempts: 1 }],
      [{ expiresAfterDays: 0 }],
      [{ requireDigit: 'yes' }],
      [{ minLength: null }],
    ])('rejects out-of-range settings (%j)', async (input) => {
      await expect(service.updatePolicy('t1', input as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.passwordPolicy.upsert).not.toHaveBeenCalled();
    });

    it('clears optional limits with null', async () => {
      stored({ expiresAfterDays: 90, maxFailedAttempts: 5 });
      await expect(
        service.updatePolicy('t1', {
          expiresAfterDays: null,
          maxFailedAttempts: null,
        }),
      ).resolves.toMatchObject({
        expiresAfterDays: null,
        maxFailedAttempts: null,
      });
    });
  });

  describe('assertAcceptable', () => {
    it('rejects a password outside the tenant policy with what is missing', async () => {
      stored({ minLength: 10, requireSymbol: true });
      await expect(
        service.assertAcceptable('abcdefgh', { tenantId: 't1' }),
      ).rejects.toThrow(
        'A senha deve ter no mínimo 10 caracteres, um símbolo.',
      );
    });

    it('blocks reusing the current or a recent password', async () => {
      stored({ historySize: 3 });
      prisma.user.findUnique.mockResolvedValue({
        password: await bcrypt.hash('Current-pass-1', 4),
      });
      prisma.passwordHistory.findMany.mockResolvedValue([
        { hash: await bcrypt.hash('Older-pass-1', 4) },
      ]);

      await expect(
        service.assertAcceptable('Current-pass-1', {
          tenantId: 't1',
          userId: 'u1',
        }),
      ).rejects.toThrow('não pode repetir nenhuma das últimas 3 senhas');
      await expect(
        service.assertAcceptable('Older-pass-1', {
          tenantId: 't1',
          userId: 'u1',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.assertAcceptable('Brand-new-pass-1', {
          tenantId: 't1',
          userId: 'u1',
        }),
      ).resolves.toBeUndefined();
      // Atual + (historySize - 1) anteriores.
      expect(prisma.passwordHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' }, take: 2 }),
      );
    });

    it('skips the history check when the policy keeps no history', async () => {
      await service.assertAcceptable('whatever-123', {
        tenantId: 't1',
        userId: 'u1',
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  it('keeps at most 24 previous hashes per user', async () => {
    prisma.passwordHistory.findMany.mockResolvedValue([
      { id: 'old-1' },
      { id: 'old-2' },
    ]);
    await service.rememberPreviousHash('u1', 'hash-old');
    expect(prisma.passwordHistory.create).toHaveBeenCalledWith({
      data: { userId: 'u1', hash: 'hash-old' },
    });
    expect(prisma.passwordHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' }, skip: 24 }),
    );
    expect(prisma.passwordHistory.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-1', 'old-2'] } },
    });
  });

  it('expires passwords older than the policy allows (unknown age never expires)', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, expiresAfterDays: 30 };
    const now = new Date('2026-10-01T00:00:00Z');
    expect(
      service.isExpired(
        { passwordChangedAt: new Date('2026-08-01') },
        policy,
        now,
      ),
    ).toBe(true);
    expect(
      service.isExpired(
        { passwordChangedAt: new Date('2026-09-20') },
        policy,
        now,
      ),
    ).toBe(false);
    expect(service.isExpired({ passwordChangedAt: null }, policy, now)).toBe(
      false,
    );
    expect(
      service.isExpired(
        { passwordChangedAt: new Date('2000-01-01') },
        DEFAULT_PASSWORD_POLICY,
        now,
      ),
    ).toBe(false);
  });

  it('uses the tenant lockout limits, falling back to the global ones', async () => {
    process.env.LOGIN_MAX_FAILED_ATTEMPTS = '7';
    process.env.LOGIN_LOCKOUT_MINUTES = '20';
    await expect(service.lockoutFor('t1')).resolves.toEqual({
      maxAttempts: 7,
      lockoutMinutes: 20,
    });

    stored({ maxFailedAttempts: 3, lockoutMinutes: 60 });
    await expect(service.lockoutFor('t1')).resolves.toEqual({
      maxAttempts: 3,
      lockoutMinutes: 60,
    });
  });
});

describe('PasswordPolicyController authorization', () => {
  const roles = (method: 'get' | 'update') =>
    Reflect.getMetadata(
      ROLES_KEY,
      (PasswordPolicyController.prototype as any)[method],
    );

  it('lets OWNER/ADMIN read it but only OWNER change it, in the session tenant', async () => {
    expect(roles('get')).toEqual(['OWNER', 'ADMIN']);
    expect(roles('update')).toEqual(['OWNER']);

    const policies = { getPolicy: jest.fn(), updatePolicy: jest.fn() };
    const controller = new PasswordPolicyController(policies as any);
    const req = { user: { tenantId: 't1', userId: 'owner-1' } };
    await controller.update(req, { minLength: 12 });
    expect(policies.updatePolicy).toHaveBeenCalledWith(
      't1',
      { minLength: 12 },
      'owner-1',
    );
  });
});

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (value: string) => `hash:${value}`),
  compare: jest.fn(
    async (value: string, hash: string) => hash === `hash:${value}`,
  ),
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { encryptSecret } from '@organator/cloud-providers';
import { MfaService } from './mfa.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('MfaService — challenge, lockout and recovery codes', () => {
  let prisma: any;
  let audit: any;
  let service: MfaService;
  let user: any;
  let secret: string;
  let challenges: any[];

  const validCode = async () => {
    const { generate } = await import('otplib');
    return generate({ secret });
  };

  beforeEach(async () => {
    const { generateSecret } = await import('otplib');
    secret = generateSecret();
    user = {
      id: 'u1',
      email: 'owner@acme.com',
      tenantId: 't1',
      mfaEnabled: true,
      mfaSecretEncrypted: encryptSecret(secret),
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    };
    challenges = [];
    prisma = {
      mfaChallenge: {
        create: jest.fn(async ({ data }) => {
          const row = {
            id: `c${challenges.length + 1}`,
            consumedAt: null,
            ...data,
          };
          challenges.push(row);
          return row;
        }),
        findUnique: jest.fn(
          async ({ where }) =>
            challenges.find((c) => c.tokenHash === where.tokenHash) ?? null,
        ),
        update: jest.fn(async ({ where, data }) =>
          Object.assign(
            challenges.find((c) => c.id === where.id),
            data,
          ),
        ),
      },
      user: {
        findUnique: jest.fn(async ({ where }) =>
          where.id === user.id ? user : null,
        ),
        update: jest.fn(async ({ data }) => Object.assign(user, data)),
      },
      mfaRecoveryCode: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 10 }),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new MfaService(prisma, audit);
  });

  it('stores only the SHA-256 of the challenge token, with a 5 minute TTL', async () => {
    const before = Date.now();
    const { challenge_token, expires_at } = await service.createChallenge(user);

    const stored = prisma.mfaChallenge.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(sha256(challenge_token));
    expect(JSON.stringify(stored)).not.toContain(challenge_token);
    const ttl = new Date(expires_at).getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(5 * 60 * 1000 - 50);
    expect(ttl).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.mfa_challenge_created' }),
    );
  });

  it('accepts a valid TOTP code, consumes the challenge and resets counters', async () => {
    user.mfaFailedAttempts = 3;
    const { challenge_token } = await service.createChallenge(user);

    await expect(
      service.verifyChallenge(challenge_token, await validCode()),
    ).resolves.toBe(user);
    expect(challenges[0].consumedAt).toBeInstanceOf(Date);
    expect(user.mfaFailedAttempts).toBe(0);
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'auth.mfa_succeeded' }),
    );
  });

  it('rejects a challenge that was already consumed (no replay)', async () => {
    const { challenge_token } = await service.createChallenge(user);
    const code = await validCode();
    await service.verifyChallenge(challenge_token, code);

    await expect(
      service.verifyChallenge(challenge_token, code),
    ).rejects.toThrow('expirado ou inválido');
  });

  it('rejects expired and unknown challenges', async () => {
    const { challenge_token } = await service.createChallenge(user);
    challenges[0].expiresAt = new Date(Date.now() - 1000);

    await expect(
      service.verifyChallenge(challenge_token, await validCode()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.verifyChallenge('bogus', '000000'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound when the challenge user no longer exists', async () => {
    const { challenge_token } = await service.createChallenge(user);
    challenges[0].userId = 'ghost';
    await expect(
      service.verifyChallenge(challenge_token, '000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('counts failures and locks MFA for 15 minutes on the 5th wrong code', async () => {
    const { challenge_token } = await service.createChallenge(user);

    for (let i = 1; i <= 4; i++) {
      await expect(
        service.verifyChallenge(challenge_token, '000000'),
      ).rejects.toThrow('Código MFA inválido');
      expect(user.mfaFailedAttempts).toBe(i);
    }
    await expect(
      service.verifyChallenge(challenge_token, '000000'),
    ).rejects.toThrow('Código MFA inválido');
    expect(user.mfaFailedAttempts).toBe(0);
    const lockMs = user.mfaLockedUntil.getTime() - Date.now();
    expect(lockMs).toBeGreaterThan(14 * 60 * 1000);
    expect(lockMs).toBeLessThanOrEqual(15 * 60 * 1000);

    // Mesmo com código correto, o usuário segue bloqueado.
    await expect(
      service.verifyChallenge(challenge_token, await validCode()),
    ).rejects.toThrow('bloqueado');
  });

  it('fails when neither code nor recovery code is provided', async () => {
    const { challenge_token } = await service.createChallenge(user);
    await expect(service.verifyChallenge(challenge_token)).rejects.toThrow(
      'Código MFA inválido',
    );
  });

  describe('recovery codes', () => {
    it('accepts an unused recovery code exactly once', async () => {
      prisma.mfaRecoveryCode.findMany.mockResolvedValue([
        { id: 'r1', codeHash: 'hash:OTHER' },
        { id: 'r2', codeHash: 'hash:ABCDEF1234' },
      ]);
      const { challenge_token } = await service.createChallenge(user);

      await expect(
        service.verifyChallenge(challenge_token, undefined, 'ABCDEF1234'),
      ).resolves.toBe(user);
      expect(prisma.mfaRecoveryCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'r2', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: 'auth.mfa_recovery_used' }),
      );
    });

    it('rejects a recovery code consumed concurrently', async () => {
      prisma.mfaRecoveryCode.findMany.mockResolvedValue([
        { id: 'r1', codeHash: 'hash:CODE' },
      ]);
      prisma.mfaRecoveryCode.updateMany.mockResolvedValue({ count: 0 });
      const { challenge_token } = await service.createChallenge(user);

      await expect(
        service.verifyChallenge(challenge_token, undefined, 'CODE'),
      ).rejects.toThrow('Código MFA inválido');
    });

    it('issues 10 fresh hashed codes after verifying TOTP, replacing old ones', async () => {
      const { recovery_codes } = await service.issueRecoveryCodes(
        user.id,
        await validCode(),
      );

      expect(recovery_codes).toHaveLength(10);
      expect(new Set(recovery_codes).size).toBe(10);
      recovery_codes.forEach((c) => expect(c).toMatch(/^[0-9A-F]{10}$/));
      expect(prisma.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      const rows = prisma.mfaRecoveryCode.createMany.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.codeHash)).toEqual(
        recovery_codes.map((c) => `hash:${c}`),
      );
    });

    it('refuses to issue codes with an invalid TOTP', async () => {
      await expect(
        service.issueRecoveryCodes(user.id, '000000'),
      ).rejects.toThrow('Código TOTP inválido');
      expect(prisma.mfaRecoveryCode.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('status / enroll / disable', () => {
    it('reports status', async () => {
      await expect(service.status('u1')).resolves.toEqual({
        enabled: true,
        method: 'totp',
      });
      user.mfaEnabled = false;
      await expect(service.status('u1')).resolves.toEqual({
        enabled: false,
        method: null,
      });
      await expect(service.status('ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('does not re-enroll a user that already has MFA', async () => {
      await expect(service.enroll('u1')).resolves.toEqual({
        alreadyEnabled: true,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('requires enrollment before enabling', async () => {
      user.mfaEnabled = false;
      user.mfaSecretEncrypted = null;
      await expect(service.enable('u1', '123456')).rejects.toThrow(
        'Enrole o MFA',
      );
    });

    it('rejects enabling with a wrong code', async () => {
      user.mfaEnabled = false;
      await expect(service.enable('u1', '000000')).rejects.toThrow(
        'Código TOTP inválido',
      );
    });

    it('disables MFA and wipes the secret with a valid code', async () => {
      await expect(service.disable('u1', await validCode())).resolves.toEqual({
        enabled: false,
      });
      expect(user).toMatchObject({
        mfaEnabled: false,
        mfaSecretEncrypted: null,
      });
    });

    it('refuses to disable with a wrong code or when inactive', async () => {
      await expect(service.disable('u1', '000000')).rejects.toThrow(
        'Código TOTP inválido',
      );
      user.mfaEnabled = false;
      await expect(service.disable('u1', await validCode())).rejects.toThrow(
        'MFA não está ativo',
      );
    });

    it('verifyCode is false for users without active MFA', async () => {
      user.mfaEnabled = false;
      await expect(service.verifyCode('u1', await validCode())).resolves.toBe(
        false,
      );
      await expect(service.verifyCode('ghost', '000000')).resolves.toBe(false);
    });
  });
});

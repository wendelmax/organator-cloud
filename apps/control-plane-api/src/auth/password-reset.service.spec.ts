import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { BadRequestException, Logger } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';

const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

describe('PasswordResetService', () => {
  const originalEnv = { ...process.env };
  let prisma: any;
  let audit: { record: jest.Mock };
  let mail: { send: jest.Mock };
  let service: PasswordResetService;

  const user = {
    id: 'u1',
    email: 'owner@acme.com',
    authProvider: 'credentials',
  };

  beforeEach(() => {
    process.env.BACKOFFICE_URL = 'https://app.acme.com/';
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        update: jest.fn(),
      },
      passwordResetToken: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userSession: { updateMany: jest.fn() },
    };
    prisma.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(prisma));
    audit = { record: jest.fn() };
    mail = { send: jest.fn() };
    service = new PasswordResetService(prisma, audit as any, mail as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  /** Token em texto puro extraído do link enviado por e-mail. */
  const sentToken = () =>
    /token=([\w-]+)/.exec(mail.send.mock.calls[0][0].text)![1];

  describe('requestReset', () => {
    it('e-mails a one-hour link and stores only the token hash', async () => {
      const before = Date.now();
      await service.requestReset(' owner@acme.com ', '10.0.0.1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'owner@acme.com' },
      });
      const message = mail.send.mock.calls[0][0];
      expect(message.to).toBe('owner@acme.com');
      expect(message.text).toContain(
        'https://app.acme.com/reset-password?token=',
      );

      const token = sentToken();
      const { data } = prisma.passwordResetToken.create.mock.calls[0][0];
      expect(data.tokenHash).toBe(sha256(token));
      expect(JSON.stringify(data)).not.toContain(token);
      expect(data.purpose).toBe('reset');
      const ttl = data.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(59 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.password_reset_requested',
          ip: '10.0.0.1',
        }),
      );
    });

    it.each([
      ['unknown e-mail', null],
      ['SSO account', { ...user, authProvider: 'oidc' }],
    ])('silently ignores an %s', async (_label, found) => {
      prisma.user.findUnique.mockResolvedValue(found);
      await expect(service.requestReset('x@acme.com')).resolves.toBeUndefined();
      expect(mail.send).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('answers normally when the e-mail cannot be sent (no account enumeration)', async () => {
      mail.send.mockRejectedValue(new Error('SMTP down'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await expect(
        service.requestReset('owner@acme.com'),
      ).resolves.toBeUndefined();
    });

    it('ignores an empty e-mail', async () => {
      await service.requestReset('   ');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('does not send another e-mail within the cooldown', async () => {
      prisma.passwordResetToken.findFirst.mockResolvedValue({ id: 't0' });
      await service.requestReset('owner@acme.com');
      expect(mail.send).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('sendActivation', () => {
    it('e-mails a three-day activation link', async () => {
      const before = Date.now();
      await service.sendActivation('u1');

      const { data } = prisma.passwordResetToken.create.mock.calls[0][0];
      expect(data.purpose).toBe('activation');
      expect(data.expiresAt.getTime() - before).toBeGreaterThan(71 * 3600_000);
      expect(mail.send.mock.calls[0][0].subject).toMatch(/Ative sua conta/);
    });

    it('never throws: a mail failure must not break tenant creation', async () => {
      mail.send.mockRejectedValue(new Error('SMTP down'));
      await expect(service.sendActivation('u1')).resolves.toBeUndefined();
    });

    it('skips SSO accounts', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        authProvider: 'oidc',
      });
      await service.sendActivation('u1');
      expect(mail.send).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    beforeEach(() => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        purpose: 'reset',
      });
    });

    it('sets the password, consumes the token and signs out every session', async () => {
      await expect(
        service.resetPassword('the-token', 'NewPass123'),
      ).resolves.toEqual({ success: true });

      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256('the-token') },
      });
      expect(prisma.passwordResetToken.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 't1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
        data: { usedAt: expect.any(Date) },
      });
      const { data } = prisma.user.update.mock.calls[0][0];
      await expect(bcrypt.compare('NewPass123', data.password)).resolves.toBe(
        true,
      );
      expect(data).toMatchObject({
        mustChangePassword: false,
        failedLoginAttempts: 0,
        loginLockedUntil: null,
      });
      expect(prisma.passwordResetToken.updateMany).toHaveBeenNthCalledWith(2, {
        where: { userId: 'u1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.password_reset' }),
      );
    });

    it('audits an activation separately', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        purpose: 'activation',
      });
      await service.resetPassword('the-token', 'NewPass123');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.account_activated' }),
      );
    });

    it('rejects an unknown token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword('nope', 'NewPass123')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a used or expired token (including a concurrent second use)', async () => {
      prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.resetPassword('the-token', 'NewPass123'),
      ).rejects.toThrow('Link inválido ou expirado');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('enforces the minimum password length before touching the token', async () => {
      await expect(service.resetPassword('the-token', 'short')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
    });
  });
});

import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptSecret, decryptSecret } from '@organator/cloud-providers';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';

const SERVICE_NAME = 'Organator Cloud';

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService?: AuditService,
  ) {}

  private hashChallenge(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async createChallenge(user: { id: string; tenantId: string; email: string }) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.prisma.mfaChallenge.create({
      data: { tokenHash: this.hashChallenge(token), userId: user.id, tenantId: user.tenantId, expiresAt },
    });
    await this.auditService?.record({
      actorId: user.id, actorEmail: user.email, action: 'auth.mfa_challenge_created',
      resourceType: 'Auth', resourceId: user.id, changes: { expiresAt: expiresAt.toISOString() },
    });
    return { challenge_token: token, expires_at: expiresAt.toISOString() };
  }

  async verifyChallenge(challengeToken: string, code?: string, recoveryCode?: string) {
    const challenge = await this.prisma.mfaChallenge.findUnique({ where: { tokenHash: this.hashChallenge(challengeToken) } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      throw new BadRequestException('Desafio MFA expirado ou inválido');
    }
    const user = await this.prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.mfaLockedUntil && user.mfaLockedUntil > new Date()) {
      throw new BadRequestException('MFA temporariamente bloqueado');
    }
    let valid = false;
    let recoveryUsed = false;
    if (recoveryCode) {
      const codes = await this.prisma.mfaRecoveryCode.findMany({ where: { userId: user.id, usedAt: null } });
      for (const stored of codes) {
        if (await bcrypt.compare(recoveryCode, stored.codeHash)) {
          const consumed = await this.prisma.mfaRecoveryCode.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: new Date() } });
          valid = consumed.count === 1;
          recoveryUsed = valid;
          break;
        }
      }
    } else if (code) {
      valid = await this.verifyCode(user.id, code);
    }
    if (!valid) {
      const attempts = user.mfaFailedAttempts + 1;
      await this.prisma.user.update({ where: { id: user.id }, data: attempts >= 5 ? { mfaFailedAttempts: 0, mfaLockedUntil: new Date(Date.now() + 15 * 60 * 1000) } : { mfaFailedAttempts: attempts } });
      await this.auditService?.record({ actorId: user.id, actorEmail: user.email, action: 'auth.mfa_failed', resourceType: 'Auth', resourceId: user.id, changes: { attempt: attempts } });
      throw new BadRequestException('Código MFA inválido');
    }
    await this.prisma.$transaction([
      this.prisma.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({ where: { id: user.id }, data: { mfaFailedAttempts: 0, mfaLockedUntil: null } }),
    ]);
    await this.auditService?.record({ actorId: user.id, actorEmail: user.email, action: recoveryUsed ? 'auth.mfa_recovery_used' : 'auth.mfa_succeeded', resourceType: 'Auth', resourceId: user.id, changes: {} });
    return user;
  }

  async issueRecoveryCodes(userId: string, code: string) {
    if (!(await this.verifyCode(userId, code))) throw new BadRequestException('Código TOTP inválido');
    const values = Array.from({ length: 10 }, () => randomBytes(5).toString('hex').toUpperCase());
    await this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } });
    await this.prisma.mfaRecoveryCode.createMany({ data: await Promise.all(values.map(async (value) => ({ userId, codeHash: await bcrypt.hash(value, 12) }))) });
    await this.auditService?.record({ actorId: userId, action: 'auth.mfa_reenrolled', resourceType: 'Auth', resourceId: userId, changes: { codesIssued: values.length } });
    return { recovery_codes: values };
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return {
      enabled: user.mfaEnabled,
      method: user.mfaEnabled ? 'totp' : null,
    };
  }

  async enroll(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.mfaEnabled) {
      return { alreadyEnabled: true };
    }

    const { generateSecret, generateURI } = await import('otplib');
    const secret = generateSecret();
    const otpauthUrl = generateURI({
      issuer: SERVICE_NAME,
      label: user.email,
      secret,
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: encryptSecret(secret) },
    });
    return { secret, otpauthUrl };
  }

  async enable(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.mfaSecretEncrypted) {
      throw new BadRequestException('Enrole o MFA antes de ativá-lo');
    }
    const secret = decryptSecret(user.mfaSecretEncrypted);
    const { verify } = await import('otplib');
    const isValid = (await verify({ token: code, secret })).valid;
    if (!isValid) {
      throw new BadRequestException('Código TOTP inválido');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });
    return { enabled: true };
  }

  async disable(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw new BadRequestException('MFA não está ativo');
    }
    const secret = decryptSecret(user.mfaSecretEncrypted);
    const { verify } = await import('otplib');
    const isValid = (await verify({ token: code, secret })).valid;
    if (!isValid) {
      throw new BadRequestException('Código TOTP inválido');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecretEncrypted: null },
    });
    return { enabled: false };
  }

  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled || !user.mfaSecretEncrypted) return false;
    const secret = decryptSecret(user.mfaSecretEncrypted);
    const { verify } = await import('otplib');
    return (await verify({ token: code, secret })).valid;
  }
}

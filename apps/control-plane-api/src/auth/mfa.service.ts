import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptSecret, decryptSecret } from '@organator/cloud-providers';

const SERVICE_NAME = 'Organator Cloud';

@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

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

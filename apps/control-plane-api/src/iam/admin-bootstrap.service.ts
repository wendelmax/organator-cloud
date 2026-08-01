import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

/**
 * Garante que o admin default do platform exista no primeiro boot:
 * - cria um tenant 'platform' dedicado
 * - cria admin@organator.app com senha aleatória (impressa UMA vez nos logs)
 * - marca mustChangePassword=true (troca obrigatória no 1º login)
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    const email = process.env.PLATFORM_ADMIN_EMAIL || 'admin@organator.app';
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return;
    }

    const randomPassword = crypto.randomBytes(16).toString('base64url');
    const hashed = await bcrypt.hash(randomPassword, 10);

    const platformTenant =
      (await this.prisma.tenant.findUnique({ where: { slug: 'platform' } })) ||
      (await this.prisma.tenant.create({
        data: { name: 'Platform', slug: 'platform', plan: 'enterprise' },
      }));

    await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        name: 'Platform Admin',
        role: 'PLATFORM_ADMIN',
        tenantId: platformTenant.id,
        mustChangePassword: true,
        authProvider: 'credentials',
      },
    });

    this.logger.warn(
      `[BOOTSTRAP] Admin default criado: ${email} | senha temporária (imprime apenas nesta 1ª inicialização): ${randomPassword}`,
    );
    this.logger.warn(
      '[BOOTSTRAP] A senha temporária NÃO será exibida novamente. Altere-a no primeiro login.',
    );
  }
}

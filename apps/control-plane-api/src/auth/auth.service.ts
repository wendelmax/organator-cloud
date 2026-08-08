import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { MfaService } from './mfa.service';
import { MfaPolicyService } from './mfa-policy.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mfaService: MfaService,
    private readonly mfaPolicy: MfaPolicyService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) return null;

    await this.assertTenantActive(user.tenantId);

    const isMatch = await bcrypt
      .compare(pass, user.password)
      .catch(() => user.password === pass);
    if (isMatch) {
      const result = { ...user } as Partial<typeof user>;
      delete result.password;
      return result;
    }
    return null;
  }

  async assertTenantActive(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, state: true },
    });
    const state = tenant?.state || 'active';
    // Login bloqueado para suspended/offboarding/deleted (#46).
    // past_due pode logar para manter acesso de leitura durante a graça.
    if (['suspended', 'offboarding', 'deleted'].includes(state)) {
      const label = state === 'suspended' ? 'suspenso' : 'arquivado';
      throw new ForbiddenException(
        `Acesso bloqueado: o tenant está ${label}. Regularize o pagamento para reativar o serviço.`,
      );
    }
  }

  async login(user: any) {
    if (!user.mfaBypass && await this.mfaPolicy.requiresMfa(user.tenantId, user.role, user.idpMfa)) {
      return {
        mfa_required: true,
        ...(await this.mfaService.createChallenge(user)),
        user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
      };
    }
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        mustChangePassword: user.mustChangePassword,
        mfaEnabled: user.mfaEnabled,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const safe = { ...user } as Partial<typeof user>;
    delete safe.password;
    delete safe.mfaSecretEncrypted;
    return safe;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException(
        'A nova senha deve ter no mínimo 8 caracteres',
      );
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da atual');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const isMatch = await bcrypt
      .compare(currentPassword, user.password)
      .catch(() => user.password === currentPassword);
    if (!isMatch) {
      throw new UnauthorizedException('Senha atual incorreta');
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, mustChangePassword: false },
    });
    return { success: true, message: 'Senha atualizada com sucesso' };
  }
}

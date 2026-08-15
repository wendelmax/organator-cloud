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
import * as crypto from 'crypto';

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

  async login(user: any, context: { ip?: string; userAgent?: string } = {}) {
    if (!user.mfaBypass && await this.mfaPolicy.requiresMfa(user.tenantId, user.role, user.idpMfa)) {
      return {
        mfa_required: true,
        ...(await this.mfaService.createChallenge(user)),
        user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
      };
    }
    const { session, refreshToken } = await this.createSession(user.id, context, { tenantId: user.tenantId, role: user.role });
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword,
      sessionId: session.id,
    };
    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: refreshToken,
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

  listSessions(userId: string) { return this.prisma.userSession.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' }, select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true } }); }

  async revokeSession(userId: string, sessionId: string) { const session = await this.prisma.userSession.findFirst({ where: { id: sessionId, userId, revokedAt: null } }); if (!session) throw new NotFoundException('Session not found'); await this.prisma.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }); return { revoked: true }; }

  async revokeOtherSessions(userId: string, currentSessionId: string) {
    const result = await this.prisma.userSession.updateMany({ where: { userId, id: { not: currentSessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
    return { revoked: result.count };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const safe = { ...user } as Partial<typeof user>;
    delete safe.password;
    delete safe.mfaSecretEncrypted;
    return safe;
  }

  async switchTenant(userId: string, tenantId: string) {
    const membership = await this.prisma.tenantMembership.findFirst({ where: { userId, tenantId, status: 'active' }, include: { tenant: { select: { state: true } } } });
    if (!membership || ['suspended', 'offboarding', 'deleted'].includes(membership.tenant.state)) throw new ForbiddenException('Tenant context is not available');
    const { session, refreshToken } = await this.createSession(userId, {}, { tenantId, role: membership.role });
    return { access_token: this.jwtService.sign({ email: (await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } })).email, sub: userId, role: membership.role, tenantId, sessionId: session.id }), refresh_token: refreshToken };
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException('Refresh token is required');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const session = await this.prisma.userSession.findUnique({ where: { tokenHash }, include: { user: { select: { email: true, tenantId: true, role: true, mustChangePassword: true } } } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('Refresh session is invalid or expired');
    await this.prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return { access_token: this.jwtService.sign({ email: session.user.email, sub: session.userId, role: session.role || session.user.role, tenantId: session.tenantId || session.user.tenantId, mustChangePassword: session.user.mustChangePassword, sessionId: session.id }) };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionId?: string,
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
    await this.prisma.userSession.updateMany({ where: { userId, ...(currentSessionId ? { id: { not: currentSessionId } } : {}), revokedAt: null }, data: { revokedAt: new Date() } });
    return { success: true, message: 'Senha atualizada com sucesso' };
  }

  private async createSession(userId: string, context: { ip?: string; userAgent?: string } = {}, authContext: { tenantId?: string; role?: string } = {}) {
    const limit = Math.max(1, Number(process.env.MAX_ACTIVE_SESSIONS_PER_USER) || 5);
    const active = await this.prisma.userSession.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    const evict = active.slice(0, Math.max(0, active.length - limit + 1)).map((session: { id: string }) => session.id);
    if (evict.length) await this.prisma.userSession.updateMany({ where: { id: { in: evict } }, data: { revokedAt: new Date() } });
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const session = await this.prisma.userSession.create({ data: { userId, tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'), tenantId: authContext.tenantId, role: authContext.role, ip: context.ip, userAgent: context.userAgent, expiresAt: new Date(Date.now() + 30 * 86400000) } });
    return { session, refreshToken };
  }
}

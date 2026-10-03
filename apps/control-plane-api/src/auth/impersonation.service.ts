import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Duração máxima de uma sessão de suporte (sem refresh). */
export const IMPERSONATION_MINUTES = 30;

/**
 * Impersonação para suporte (#103): o admin da plataforma vê a plataforma como
 * o usuário vê, numa sessão curta, marcada e auditada do início ao fim.
 */
@Injectable()
export class ImpersonationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async start(
    admin: {
      userId: string;
      email?: string;
      role?: string;
      impersonatorId?: string;
    },
    input: { userId?: string; reason?: string },
    context: { ip?: string | null; userAgent?: string | null } = {},
  ) {
    if (admin.role !== 'PLATFORM_ADMIN' || admin.impersonatorId) {
      // Impersonação em cadeia nunca: só o admin, na própria sessão.
      throw new ForbiddenException(
        'Only a platform admin can start a support session',
      );
    }
    const reason = (input.reason ?? '').trim();
    if (!input.userId || reason.length < 5) {
      throw new BadRequestException(
        'userId and a reason (5+ characters) are required',
      );
    }
    if (input.userId === admin.userId) {
      throw new BadRequestException('You cannot impersonate yourself');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: input.userId },
      include: { tenant: { select: { state: true } } },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.role === 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Platform admins cannot be impersonated');
    }
    if (['offboarding', 'deleted'].includes(target.tenant?.state ?? '')) {
      throw new ForbiddenException(
        'The user organization is no longer available',
      );
    }

    const expiresAt = new Date(Date.now() + IMPERSONATION_MINUTES * 60_000);
    // Sessão própria, sem refresh utilizável e sem derrubar as sessões do usuário.
    const session = await this.prisma.userSession.create({
      data: {
        userId: target.id,
        tokenHash: crypto
          .createHash('sha256')
          .update(crypto.randomBytes(32).toString('hex'))
          .digest('hex'),
        tenantId: target.tenantId,
        role: target.role,
        ip: context.ip ?? null,
        userAgent: context.userAgent?.slice(0, 300) ?? null,
        expiresAt,
        impersonatorId: admin.userId,
        impersonatorEmail: admin.email ?? null,
        impersonationReason: reason.slice(0, 500),
      },
    });
    const accessToken = this.jwt.sign(
      {
        sub: target.id,
        email: target.email,
        role: target.role,
        tenantId: target.tenantId,
        sessionId: session.id,
        impersonator: admin.userId,
      },
      { expiresIn: `${IMPERSONATION_MINUTES}m` },
    );

    await this.audit.record({
      actorId: admin.userId,
      actorEmail: admin.email ?? null,
      ip: context.ip ?? null,
      action: 'auth.impersonation_started',
      resourceType: 'User',
      resourceId: target.id,
      changes: {
        sessionId: session.id,
        reason,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      access_token: accessToken,
      expiresAt,
      user: {
        id: target.id,
        email: target.email,
        role: target.role,
        tenantId: target.tenantId,
      },
    };
  }

  /** Encerra a sessão de suporte atual (revoga e audita a duração). */
  async stop(user: {
    userId: string;
    sessionId?: string;
    impersonatorId?: string;
  }) {
    if (!user.impersonatorId || !user.sessionId) {
      throw new BadRequestException('This is not a support session');
    }
    const session = await this.prisma.userSession.findUnique({
      where: { id: user.sessionId },
    });
    const now = new Date();
    await this.prisma.userSession.update({
      where: { id: user.sessionId },
      data: { revokedAt: now },
    });
    const durationSeconds = session
      ? Math.round((now.getTime() - session.createdAt.getTime()) / 1000)
      : null;
    await this.audit.record({
      actorId: user.impersonatorId,
      action: 'auth.impersonation_ended',
      resourceType: 'User',
      resourceId: user.userId,
      changes: { sessionId: user.sessionId, durationSeconds },
    });
    return { ended: true, durationSeconds };
  }
}

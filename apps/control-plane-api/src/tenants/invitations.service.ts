import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

const MIN_PASSWORD_LENGTH = 8;
const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly entitlements?: EntitlementsService,
  ) {}

  /**
   * Envia o link de aceite ao convidado. Retorna true só se saiu por SMTP; sem
   * SMTP (ou em falha) o painel mostra o link para entrega manual.
   */
  private async deliver(
    tenantId: string,
    email: string,
    token: string,
  ): Promise<boolean> {
    if (!this.mail) return false;
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      const backoffice = (
        process.env.BACKOFFICE_URL || 'http://localhost:3000'
      ).replace(/\/+$/, '');
      await this.mail.send({
        to: email,
        subject: `Convite para ${tenant?.name ?? 'uma organização'} no Organator`,
        text: `Você foi convidado para ${tenant?.name ?? 'uma organização'} no Organator.\n\nAceite o convite (o link vale por 7 dias):\n${backoffice}/accept-invite?token=${token}\n`,
      });
      return this.mail.enabled;
    } catch (err) {
      this.logger.warn(
        `Could not e-mail the invitation to ${email}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Dados públicos do convite para a página de aceite (sem autenticação). */
  async preview(token: string) {
    const invitation = await this.prisma.tenantInvitation.findUnique({
      where: { tokenHash: hashToken(token || '') },
      include: { tenant: { select: { name: true } } },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt < new Date()
    )
      throw new NotFoundException('Invitation is invalid or expired');
    const user = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    return {
      email: invitation.email,
      role: invitation.role,
      tenantName: invitation.tenant.name,
      accountExists: user !== null,
    };
  }

  async create(
    tenantId: string,
    email: string,
    role: string,
    actorId?: string,
  ) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@'))
      throw new BadRequestException('Valid email is required');
    if (!['OWNER', 'ADMIN', 'MEMBER', 'BILLING', 'DEVELOPER'].includes(role))
      throw new BadRequestException('Invalid role');
    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (existing) {
      const membership = await this.prisma.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId: existing.id } },
      });
      if (membership)
        throw new ConflictException('User already belongs to this tenant');
    }
    const pending = await this.prisma.tenantInvitation.findFirst({
      where: {
        tenantId,
        email: normalized,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (pending) throw new ConflictException('Invitation already pending');
    const token = crypto.randomBytes(32).toString('hex');
    const invitation = await this.prisma.tenantInvitation.create({
      data: {
        tenantId,
        email: normalized,
        role,
        tokenHash: hashToken(token),
        invitedBy: actorId,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    await this.audit.record({
      actorId,
      action: 'tenant.invitation_created',
      resourceType: 'TenantInvitation',
      resourceId: invitation.id,
      changes: { tenantId, email: normalized, role },
    });
    const emailed = await this.deliver(tenantId, normalized, token);
    return {
      id: invitation.id,
      email: normalized,
      role,
      expiresAt: invitation.expiresAt,
      token,
      emailed,
    };
  }

  list(tenantId: string) {
    return this.prisma.tenantInvitation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        sentAt: true,
        createdAt: true,
      },
    });
  }

  async revoke(tenantId: string, id: string, actorId?: string) {
    const invitation = await this.prisma.tenantInvitation.findFirst({
      where: { id, tenantId, acceptedAt: null, revokedAt: null },
    });
    if (!invitation)
      throw new NotFoundException('Pending invitation not found');
    await this.prisma.tenantInvitation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId,
      action: 'tenant.invitation_revoked',
      resourceType: 'TenantInvitation',
      resourceId: id,
      changes: { tenantId, email: invitation.email },
    });
    return { revoked: true };
  }

  async resend(tenantId: string, id: string, actorId?: string) {
    const invitation = await this.prisma.tenantInvitation.findFirst({
      where: { id, tenantId, acceptedAt: null, revokedAt: null },
    });
    if (!invitation)
      throw new NotFoundException('Pending invitation not found');
    const token = crypto.randomBytes(32).toString('hex');
    const updated = await this.prisma.tenantInvitation.update({
      where: { id },
      data: {
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 86400000),
        sentAt: new Date(),
      },
    });
    await this.audit.record({
      actorId,
      action: 'tenant.invitation_resent',
      resourceType: 'TenantInvitation',
      resourceId: id,
      changes: { tenantId, email: invitation.email },
    });
    const emailed = await this.deliver(tenantId, updated.email, token);
    return {
      id: updated.id,
      email: updated.email,
      expiresAt: updated.expiresAt,
      token,
      emailed,
    };
  }

  async accept(token: string, name?: string, password?: string) {
    const hash = hashToken(token || '');
    const invitation = await this.prisma.tenantInvitation.findUnique({
      where: { tokenHash: hash },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt < new Date()
    )
      throw new NotFoundException('Invitation is invalid or expired');

    // Conta nova: a senha é escolhida pelo convidado. Validar antes de
    // consumir o convite, para um erro de digitação não queimar o link.
    const existing = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    if (!existing && (!password || password.length < MIN_PASSWORD_LENGTH)) {
      throw new BadRequestException(
        `Defina uma senha com no mínimo ${MIN_PASSWORD_LENGTH} caracteres`,
      );
    }
    const passwordHash = existing ? null : await bcrypt.hash(password!, 12);

    // O convite pode ter sido enviado com assento livre e o plano ter enchido
    // depois: checar a cota antes de consumir o convite.
    const alreadyMember = existing
      ? await this.prisma.tenantMembership.findUnique({
          where: {
            tenantId_userId: {
              tenantId: invitation.tenantId,
              userId: existing.id,
            },
          },
        })
      : null;
    if (!alreadyMember) {
      await this.entitlements?.checkQuota(invitation.tenantId, 'SEATS');
    }

    const accepted = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.tenantInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new NotFoundException('Invitation is invalid or expired');

      let user = await tx.user.findUnique({
        where: { email: invitation.email },
      });
      let accountCreated = false;
      if (!user) {
        // Conta criada entre a validação e a transação: sem senha escolhida
        // não dá para criá-la aqui.
        if (!passwordHash)
          throw new ConflictException('Account state changed, retry');
        user = await tx.user.create({
          data: {
            email: invitation.email,
            name: name?.trim() || null,
            tenantId: invitation.tenantId,
            role: invitation.role,
            password: passwordHash,
          },
        });
        accountCreated = true;
      }
      await tx.tenantMembership.create({
        data: {
          tenantId: invitation.tenantId,
          userId: user.id,
          role: invitation.role,
          status: 'active',
        },
      });
      return { user, accountCreated };
    });
    await this.audit.record({
      actorId: accepted.user.id,
      action: 'tenant.invitation_accepted',
      resourceType: 'TenantInvitation',
      resourceId: invitation.id,
      changes: { tenantId: invitation.tenantId, userId: accepted.user.id },
    });
    return {
      userId: accepted.user.id,
      email: accepted.user.email,
      accountCreated: accepted.accountCreated,
    };
  }
}

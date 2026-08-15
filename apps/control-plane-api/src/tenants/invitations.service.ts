import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
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
    return {
      id: invitation.id,
      email: normalized,
      role,
      expiresAt: invitation.expiresAt,
      token,
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
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
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
    return {
      id: updated.id,
      email: updated.email,
      expiresAt: updated.expiresAt,
      token,
    };
  }

  async accept(token: string, name?: string) {
    const hash = crypto
      .createHash('sha256')
      .update(token || '')
      .digest('hex');
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
      let temporaryPassword: string | null = null;
      if (!user) {
        temporaryPassword = crypto.randomBytes(24).toString('base64url');
        user = await tx.user.create({
          data: {
            email: invitation.email,
            name: name?.trim() || null,
            tenantId: invitation.tenantId,
            role: invitation.role,
            password: await bcrypt.hash(temporaryPassword, 12),
            mustChangePassword: true,
          },
        });
      }
      await tx.tenantMembership.create({
        data: {
          tenantId: invitation.tenantId,
          userId: user.id,
          role: invitation.role,
          status: 'active',
        },
      });
      return { user, temporaryPassword };
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
      temporaryPassword: accepted.temporaryPassword,
      mustChangePassword: accepted.temporaryPassword !== null,
    };
  }
}

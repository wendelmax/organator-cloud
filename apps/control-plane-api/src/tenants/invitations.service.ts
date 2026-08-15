import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(tenantId: string, email: string, role: string, actorId?: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) throw new BadRequestException('Valid email is required');
    if (!['OWNER', 'ADMIN', 'MEMBER', 'DEVELOPER'].includes(role)) throw new BadRequestException('Invalid role');
    const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (existing) throw new ConflictException('User already exists');
    const pending = await this.prisma.tenantInvitation.findFirst({ where: { tenantId, email: normalized, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (pending) throw new ConflictException('Invitation already pending');
    const token = crypto.randomBytes(32).toString('hex');
    const invitation = await this.prisma.tenantInvitation.create({ data: { tenantId, email: normalized, role, tokenHash: crypto.createHash('sha256').update(token).digest('hex'), invitedBy: actorId, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    await this.audit.record({ actorId, action: 'tenant.invitation_created', resourceType: 'TenantInvitation', resourceId: invitation.id, changes: { tenantId, email: normalized, role } });
    return { id: invitation.id, email: normalized, role, expiresAt: invitation.expiresAt, token };
  }

  list(tenantId: string) { return this.prisma.tenantInvitation.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true, sentAt: true, createdAt: true } }); }

  async revoke(tenantId: string, id: string, actorId?: string) {
    const invitation = await this.prisma.tenantInvitation.findFirst({ where: { id, tenantId, acceptedAt: null, revokedAt: null } });
    if (!invitation) throw new NotFoundException('Pending invitation not found');
    await this.prisma.tenantInvitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ actorId, action: 'tenant.invitation_revoked', resourceType: 'TenantInvitation', resourceId: id, changes: { tenantId, email: invitation.email } });
    return { revoked: true };
  }

  async resend(tenantId: string, id: string, actorId?: string) {
    const invitation = await this.prisma.tenantInvitation.findFirst({ where: { id, tenantId, acceptedAt: null, revokedAt: null } });
    if (!invitation) throw new NotFoundException('Pending invitation not found');
    const token = crypto.randomBytes(32).toString('hex');
    const updated = await this.prisma.tenantInvitation.update({ where: { id }, data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 7 * 86400000), sentAt: new Date() } });
    await this.audit.record({ actorId, action: 'tenant.invitation_resent', resourceType: 'TenantInvitation', resourceId: id, changes: { tenantId, email: invitation.email } });
    return { id: updated.id, email: updated.email, expiresAt: updated.expiresAt, token };
  }

  async accept(token: string, name?: string) {
    const hash = crypto.createHash('sha256').update(token || '').digest('hex');
    const invitation = await this.prisma.tenantInvitation.findUnique({ where: { tokenHash: hash } });
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt < new Date()) throw new NotFoundException('Invitation is invalid or expired');
    const temporaryPassword = crypto.randomBytes(24).toString('base64url');
    const user = await this.prisma.user.create({ data: { email: invitation.email, name: name?.trim() || null, tenantId: invitation.tenantId, role: invitation.role, password: await bcrypt.hash(temporaryPassword, 12), mustChangePassword: true } });
    await this.prisma.tenantMembership.create({ data: { tenantId: invitation.tenantId, userId: user.id, role: invitation.role, status: 'active' } });
    await this.prisma.tenantInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    await this.audit.record({ actorId: user.id, action: 'tenant.invitation_accepted', resourceType: 'TenantInvitation', resourceId: invitation.id, changes: { tenantId: invitation.tenantId, userId: user.id } });
    return { userId: user.id, email: user.email, temporaryPassword, mustChangePassword: true };
  }
}

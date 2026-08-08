import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const MFA_MODES = ['optional', 'required_for_roles', 'required_for_all'] as const;
export type MfaMode = (typeof MFA_MODES)[number];

@Injectable()
export class MfaPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get(tenantId: string) {
    const policy = await this.prisma.tenantSecurityPolicy.findUnique({ where: { tenantId } });
    return policy ?? { tenantId, mfaMode: 'optional', requiredRoles: [] };
  }

  async requiresMfa(tenantId: string, role: string, idpMfa?: boolean) {
    const policy = await this.get(tenantId);
    if (idpMfa === true) return false;
    if (policy.mfaMode === 'required_for_all') return true;
    if (policy.mfaMode === 'required_for_roles') {
      const roles = Array.isArray(policy.requiredRoles) ? policy.requiredRoles : [];
      return roles.includes(role);
    }
    return false;
  }

  async update(tenantId: string, actor: { userId: string; role: string; email?: string }, input: { mfaMode: string; requiredRoles?: string[] }) {
    if (!['OWNER', 'ADMIN', 'PLATFORM_ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Somente administradores podem alterar a política de MFA');
    }
    if (!MFA_MODES.includes(input.mfaMode as MfaMode)) {
      throw new BadRequestException('mfaMode inválido');
    }
    const requiredRoles = input.mfaMode === 'required_for_roles' ? (input.requiredRoles ?? []) : [];
    const policy = await this.prisma.tenantSecurityPolicy.upsert({
      where: { tenantId },
      create: { tenantId, mfaMode: input.mfaMode, requiredRoles },
      update: { mfaMode: input.mfaMode, requiredRoles },
    });
    await this.auditService.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'auth.mfa_policy_changed',
      resourceType: 'TenantSecurityPolicy',
      resourceId: tenantId,
      changes: { mfaMode: input.mfaMode, requiredRoles },
    });
    return policy;
  }
}

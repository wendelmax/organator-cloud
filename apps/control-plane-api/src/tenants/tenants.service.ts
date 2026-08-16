import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import {
  TenantState,
  VALID_STATES,
  legacyStatusFor,
} from './tenant-lifecycle.types';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export type TenantStatus = 'active' | 'suspended' | 'archived';

const VALID_PLANS = ['free', 'pro', 'enterprise'];
const VALID_STATUSES: TenantStatus[] = ['active', 'suspended', 'archived'];
const PLATFORM_ONLY_ROLES = ['PLATFORM_ADMIN'];

export function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly lifecycleService: TenantLifecycleService,
    @Optional() @InjectQueue('provisioner') private readonly provisionerQueue?: Queue,
  ) {}

  async createTenant(
    name: string,
    plan?: string,
    adminEmail?: string,
    opts: { state?: TenantState; actorId?: string; actorEmail?: string } = {},
  ) {
    const slug = normalizeSlug(name);
    const state = opts.state || 'active';
    if (!VALID_STATES.includes(state)) {
      throw new BadRequestException(
        `Invalid state "${state}". Allowed: ${VALID_STATES.join(', ')}`,
      );
    }
    let admin: { id: string } | null = null;
    if (adminEmail) {
      admin = await this.prisma.user.findUnique({
        where: { email: adminEmail },
      });
    }

    const tenant = await this.prisma.tenant.create({
      data: {
        name,
        slug,
        plan: plan || 'free',
        status: legacyStatusFor(state),
        state,
        stateChangedAt: new Date(),
        stripeId: `cus_simulated_${Date.now()}`,
        users: admin
          ? { connect: { id: admin.id } }
          : adminEmail
            ? {
                create: [
                  {
                    email: adminEmail,
                    name: 'Admin',
                    password: await bcrypt.hash(
                      crypto.randomBytes(16).toString('base64url'),
                      10,
                    ),
                    role: 'OWNER',
                    mustChangePassword: true,
                  },
                ],
              }
            : undefined,
      },
    });

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      action: 'tenant.created',
      resourceType: 'Tenant',
      resourceId: tenant.id,
      changes: { name, plan: plan || 'free', state },
    });

    await this.triggerInfraProvisioning(tenant.id, opts.actorId);

    return tenant;
  }

  async triggerInfraProvisioning(tenantId: string, actorId?: string) {
    const tenant = await this.ensureTenantExists(tenantId);
    if (this.provisionerQueue) {
      const jobId = `deploy-tenant-infra:${tenantId}:${Date.now()}`;
      await this.provisionerQueue.add('deploy-tenant-infra', {
        tenantId,
        slug: tenant.slug,
        plan: tenant.plan,
        actorId,
      }, { jobId });
    }
    return { status: 'QUEUED', tenantId };
  }

  async getTenants() {
    const tenants = await this.prisma.tenant.findMany({
      include: {
        users: {
          select: { id: true, email: true, name: true, role: true },
        },
        microservices: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      tenants.map((tenant: any) => this.enrichWithMetrics(tenant)),
    );
  }

  async getTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            createdAt: true,
          },
        },
        microservices: true,
      },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return this.enrichWithMetrics(tenant);
  }

  async updateTenant(tenantId: string, data: { name?: string; slug?: string }) {
    await this.ensureTenantExists(tenantId);

    if (data.slug) {
      const normalizedSlug = normalizeSlug(data.slug);
      if (!normalizedSlug) {
        throw new BadRequestException('Invalid slug');
      }
      const existing = await this.prisma.tenant.findUnique({
        where: { slug: normalizedSlug },
      });
      if (existing && existing.id !== tenantId) {
        throw new ConflictException('Slug already in use');
      }
      data = { ...data, slug: normalizedSlug };
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.slug !== undefined && { slug: data.slug }),
      },
    });
  }

  async changePlan(tenantId: string, plan: string, actorId?: string) {
    const current = await this.ensureTenantExists(tenantId);

    const normalizedPlan = plan.toLowerCase();
    if (!VALID_PLANS.includes(normalizedPlan)) {
      throw new BadRequestException(
        `Invalid plan. Allowed: ${VALID_PLANS.join(', ')}`,
      );
    }

    const billingPlan = await this.prisma.billingPlan.findUnique({
      where: { slug: normalizedPlan },
    });
    if (!billingPlan) {
      throw new NotFoundException(
        `BillingPlan "${normalizedPlan}" not registered`,
      );
    }

    const result = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { plan: normalizedPlan },
    });

    this.entitlementsService.bust(tenantId);

    const idempotencyKey = `plan-migration:${tenantId}:${normalizedPlan}`;
    const job = this.provisionerQueue ? await this.provisionerQueue.add('migrate-tenant-plan', {
      tenantId,
      fromPlan: current.plan,
      toPlan: normalizedPlan,
      action: 'RECONCILE_INFRA',
      idempotencyKey,
      gracePeriod: normalizedPlan === 'free' && current.plan !== 'free',
      actorId,
    }, { jobId: idempotencyKey, removeOnComplete: false }) : { id: undefined };
    await this.auditService.record({ actorId, action: 'TENANT_PLAN_CHANGED', resourceType: 'TENANT', resourceId: tenantId, changes: { from: current.plan, to: normalizedPlan, jobId: job.id, idempotencyKey } });

    // Reconcile data isolation when not overridden
    const tenantForIsolation = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenantForIsolation && !tenantForIsolation.dataIsolationOverridden) {
      const defaultMode = billingPlan.defaultDataIsolation || 'SHARED';
      if (defaultMode !== tenantForIsolation.dataIsolation) {
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: { dataIsolation: defaultMode as any },
        });
        const dp = await this.prisma.tenantDataPlane.upsert({
          where: { tenantId },
          create: { tenantId, status: 'PENDING', phase: 'PREPARE', generation: 1 },
          update: { generation: { increment: 1 }, status: 'PENDING', phase: 'PREPARE', lastError: null },
        });
        if (this.provisionerQueue) {
          const isoJobId = `data-isolation:${tenantId}:generation:${dp.generation}`;
          await this.provisionerQueue.add('reconcile-data-isolation', {
            apiVersion: 'organator.io/v1alpha1',
            tenantId,
            generation: dp.generation,
            desiredMode: defaultMode,
            actorId,
          }, { jobId: isoJobId, attempts: 5, backoff: { type: 'exponential', delay: 1000 } });
        }
      }
    }

    return { ...result, migration: { jobId: job.id, status: 'QUEUED', idempotencyKey } };
  }

  async setTenantStatus(tenantId: string, status: TenantStatus) {
    await this.ensureTenantExists(tenantId);
    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`,
      );
    }
    // Mantém a state machine em sincronia com o status legado (#34).
    const state: TenantState =
      status === 'suspended'
        ? 'suspended'
        : status === 'archived'
          ? 'offboarding'
          : 'active';
    return this.lifecycleService.transition(tenantId, state, {
      reason: 'legacy.status_set',
    });
  }

  async listMemberships(userId: string) {
    return this.prisma.tenantMembership.findMany({ where: { userId, status: 'active' }, include: { tenant: { select: { id: true, name: true, slug: true, plan: true, status: true } } }, orderBy: { createdAt: 'asc' } });
  }

  async resolveMembership(userId: string, slug: string) {
    const membership = await this.prisma.tenantMembership.findFirst({ where: { userId, status: 'active', tenant: { slug } }, include: { tenant: { select: { id: true, name: true, slug: true, plan: true, status: true, state: true } } } });
    if (!membership) throw new NotFoundException('Organization not found');
    return { tenant: membership.tenant, role: membership.role };
  }

  async suspendTenant(tenantId: string, opts: Record<string, unknown> = {}) {
    await this.ensureTenantExists(tenantId);
    return this.lifecycleService.markSuspended(tenantId, {
      reason: (opts.reason as string) || 'manual.admin',
      actorId: (opts.actorId as string) || null,
      actorEmail: (opts.actorEmail as string) || null,
    });
  }

  async reactivateTenant(tenantId: string, opts: Record<string, unknown> = {}) {
    await this.ensureTenantExists(tenantId);
    return this.lifecycleService.restoreActive(tenantId, {
      reason: (opts.reason as string) || 'manual.admin',
      actorId: (opts.actorId as string) || null,
      actorEmail: (opts.actorEmail as string) || null,
    });
  }

  async archiveTenant(tenantId: string, opts: Record<string, unknown> = {}) {
    await this.ensureTenantExists(tenantId);
    return this.lifecycleService.markOffboarding(tenantId, {
      reason: (opts.reason as string) || 'manual.admin',
      actorId: (opts.actorId as string) || null,
      actorEmail: (opts.actorEmail as string) || null,
    });
  }

  async transferOwnership(tenantId: string, newOwnerId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const newOwner = await this.prisma.user.findFirst({
      where: { id: newOwnerId, tenantId },
    });
    if (!newOwner) {
      throw new BadRequestException(
        'Transferência de ownership só é permitida para usuário do mesmo tenant',
      );
    }

    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { tenantId, role: 'OWNER' },
        data: { role: 'ADMIN' },
      }),
      this.prisma.user.update({
        where: { id: newOwnerId },
        data: { role: 'OWNER' },
      }),
    ]);

    return this.prisma.user.findUnique({
      where: { id: newOwnerId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async getTenantMetrics(tenantId: string) {
    const tenant = await this.ensureTenantExists(tenantId);
    return this.computeMetrics(tenantId, tenant.plan);
  }

  async getMembers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async addMember(
    tenantId: string,
    email: string,
    name?: string,
    role: string = 'MEMBER',
    password?: string,
    opts: { actorId?: string; actorEmail?: string; ip?: string } = {},
  ) {
    const rawPassword =
      password || crypto.randomBytes(16).toString('base64url');
    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    const normalizedRole = String(role || 'MEMBER').toUpperCase();
    const member = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        name: name || null,
        role: normalizedRole,
        password: hashedPassword,
        mustChangePassword: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      ip: opts.ip ?? null,
      action: 'tenant.member.added',
      resourceType: 'TenantMember',
      resourceId: member.id,
      changes: { tenantId, email, role: normalizedRole },
    });

    return member;
  }

  async updateMemberRole(
    tenantId: string,
    userId: string,
    role: string,
    opts: { actorId?: string; actorEmail?: string; ip?: string } = {},
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) {
      throw new NotFoundException('Member not found in tenant');
    }

    const normalizedRole = String(role).toUpperCase();
    if (PLATFORM_ONLY_ROLES.includes(normalizedRole)) {
      throw new BadRequestException(
        'PLATFORM_ADMIN não pode ser atribuído via gestão de membros',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: normalizedRole },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      ip: opts.ip ?? null,
      action: 'tenant.member.role_changed',
      resourceType: 'TenantMember',
      resourceId: userId,
      changes: {
        tenantId,
        email: user.email,
        from: user.role,
        to: normalizedRole,
      },
    });

    return updated;
  }

  async removeMember(
    tenantId: string,
    userId: string,
    opts: { actorId?: string; actorEmail?: string; ip?: string } = {},
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) {
      throw new NotFoundException('Member not found in tenant');
    }

    const remainingOwners = await this.prisma.user.count({
      where: { tenantId, role: 'OWNER' },
    });
    if (user.role === 'OWNER' && remainingOwners <= 1) {
      throw new BadRequestException(
        'Não é possível remover o único OWNER do tenant',
      );
    }

    const removed = await this.prisma.user.delete({
      where: { id: userId },
    });

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      ip: opts.ip ?? null,
      action: 'tenant.member.removed',
      resourceType: 'TenantMember',
      resourceId: userId,
      changes: { tenantId, email: user.email, role: user.role },
    });

    return removed;
  }

  async getTenantQuotaUsage(tenantId: string) {
    await this.ensureTenantExists(tenantId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    const planKey = (tenant?.plan || 'free').toLowerCase();
    const billingPlan = await this.prisma.billingPlan.findUnique({
      where: { slug: planKey },
    });
    const quotas = (billingPlan?.quotas as Record<string, number>) || null;

    const [microservices, deployments, apiDocs, users] = await Promise.all([
      this.prisma.microservice.count({ where: { tenantId } }),
      this.prisma.deployment.count({
        where: { microservice: { tenantId } },
      }),
      this.prisma.apiDoc.count({
        where: { microservice: { tenantId } },
      }),
      this.prisma.user.count({ where: { tenantId } }),
    ]);

    return {
      plan: planKey,
      limits: quotas,
      usage: {
        MICROSERVICE: microservices,
        DEPLOYMENT: deployments,
        APIS: apiDocs,
        SEATS: users,
      },
    };
  }

  private async enrichWithMetrics(tenant: any) {
    const metrics = await this.computeMetrics(tenant.id, tenant.plan);
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      status: tenant.status,
      state: tenant.state,
      graceEndsAt: tenant.graceEndsAt,
      suspendedAt: tenant.suspendedAt,
      stateChangedAt: tenant.stateChangedAt,
      stripeId: tenant.stripeId,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      users: tenant.users,
      microservices: tenant.microservices,
      metrics,
    };
  }

  private async computeMetrics(tenantId: string, planKey?: string) {
    const [microservices, deployments, apiDocs, users] = await Promise.all([
      this.prisma.microservice.count({ where: { tenantId } }),
      this.prisma.deployment.count({
        where: { microservice: { tenantId } },
      }),
      this.prisma.apiDoc.count({
        where: { microservice: { tenantId } },
      }),
      this.prisma.user.count({ where: { tenantId } }),
    ]);

    const billingPlan = planKey
      ? await this.prisma.billingPlan.findUnique({
          where: { slug: planKey.toLowerCase() },
          select: { price: true },
        })
      : null;
    const estimatedSpend = billingPlan?.price || 0;

    return {
      microservices,
      deployments,
      apiDocs,
      users,
      estimatedSpend,
    };
  }

  private async ensureTenantExists(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }
}

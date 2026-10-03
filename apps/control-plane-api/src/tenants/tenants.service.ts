import { bullJobId } from '../common/queue';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { PasswordResetService } from '../auth/password-reset.service';
import { canAssignRole } from '../auth/roles.guard';
import { cancelCustomerSubscriptions } from '../billing/stripe-subscriptions';

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
    @Optional()
    @InjectQueue('provisioner')
    private readonly provisionerQueue?: Queue,
    @Optional()
    private readonly passwordReset?: PasswordResetService,
  ) {}

  async createTenant(
    name: string,
    plan?: string,
    adminEmail?: string,
    opts: {
      state?: TenantState;
      actorId?: string;
      actorEmail?: string;
      /** Customer do Stripe (checkout); null até haver cobrança real. */
      stripeId?: string | null;
    } = {},
  ) {
    const slug = normalizeSlug(name);
    if (!slug) {
      throw new BadRequestException('Informe um nome de organização válido');
    }
    // Antes caía na unique constraint do Prisma (500).
    if (await this.prisma.tenant.findUnique({ where: { slug } })) {
      throw new ConflictException(
        `Já existe uma organização com o endereço "${slug}". Escolha outro nome.`,
      );
    }
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
        stripeId: opts.stripeId ?? null,
        // Usuário existente vira OWNER via membership (abaixo): `connect`
        // trocaria o tenant de origem dele — o admin da plataforma que cria um
        // tenant pelo painel sairia do tenant da plataforma.
        users: admin
          ? undefined
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

    if (admin) {
      await this.prisma.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: admin.id } },
        create: {
          tenantId: tenant.id,
          userId: admin.id,
          role: 'OWNER',
          status: 'active',
        },
        update: { role: 'OWNER', status: 'active' },
      });
    }

    // O dono novo nasce com senha aleatória: recebe por e-mail o link para
    // defini-la (sem isso só entraria via SSO).
    if (!admin && adminEmail && this.passwordReset) {
      const owner = await this.prisma.user.findUnique({
        where: { email: adminEmail },
        select: { id: true },
      });
      if (owner) await this.passwordReset.sendActivation(owner.id);
    }

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      action: 'tenant.created',
      resourceType: 'Tenant',
      resourceId: tenant.id,
      changes: { name, plan: plan || 'free', state },
    });

    try {
      await this.triggerInfraProvisioning(tenant.id, opts.actorId);
    } catch (err) {
      // O tenant já foi criado: a fila indisponível não deve desfazer isso.
      // O provisionamento pode ser disparado depois ("Provisionar Infra").
      await this.auditService.record({
        actorId: opts.actorId ?? null,
        action: 'tenant.infra_enqueue_failed',
        resourceType: 'Tenant',
        resourceId: tenant.id,
        changes: { error: (err as Error).message },
      });
    }

    return tenant;
  }

  async triggerInfraProvisioning(tenantId: string, actorId?: string) {
    const tenant = await this.ensureTenantExists(tenantId);
    if (this.provisionerQueue) {
      const jobId = `deploy-tenant-infra:${tenantId}:${Date.now()}`;
      await this.provisionerQueue.add(
        'deploy-tenant-infra',
        {
          tenantId,
          slug: tenant.slug,
          plan: tenant.plan,
          actorId,
        },
        { jobId: bullJobId(jobId) },
      );
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

    if (this.provisionerQueue) {
      const redisClient = await (this.provisionerQueue as any).client;
      if (redisClient) {
        await redisClient.del(`quota_cache:${tenantId}`);
      }
    }

    const planRanks: Record<string, number> = {
      free: 1,
      pro: 2,
      enterprise: 3,
    };
    const currentRank = planRanks[current.plan] || 1;
    const targetRank = planRanks[normalizedPlan] || 1;
    const isDowngrade = targetRank < currentRank;

    let graceEndsAt = null;
    let jobName = 'reconcile-plan-migration';
    let jobDelay = 0;

    if (isDowngrade) {
      graceEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days
      jobName = 'apply-downgrade-reconciliation';
      jobDelay = 7 * 24 * 60 * 60 * 1000;
    }

    const result = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { plan: normalizedPlan, graceEndsAt },
    });

    this.entitlementsService.bust(tenantId);

    const idempotencyKey = `plan-migration:${tenantId}:${normalizedPlan}`;
    const job = this.provisionerQueue
      ? await this.provisionerQueue.add(
          jobName,
          {
            tenantId,
            currentPlan: current.plan,
            targetPlan: normalizedPlan,
            action: 'RECONCILING_PLAN',
            idempotencyKey,
            actorId,
          },
          {
            jobId: bullJobId(idempotencyKey),
            delay: jobDelay,
            removeOnComplete: false,
          },
        )
      : { id: undefined };
    await this.auditService.record({
      actorId,
      action: 'TENANT_PLAN_CHANGED',
      resourceType: 'TENANT',
      resourceId: tenantId,
      changes: {
        from: current.plan,
        to: normalizedPlan,
        jobId: job?.id,
        idempotencyKey,
      },
    });

    // Reconcile data isolation when not overridden
    const tenantForIsolation = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (tenantForIsolation && !tenantForIsolation.dataIsolationOverridden) {
      const defaultMode = billingPlan.defaultDataIsolation || 'SHARED';
      if (defaultMode !== tenantForIsolation.dataIsolation) {
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: { dataIsolation: defaultMode as any },
        });
        const dp = await this.prisma.tenantDataPlane.upsert({
          where: { tenantId },
          create: {
            tenantId,
            status: 'PENDING',
            phase: 'PREPARE',
            generation: 1,
          },
          update: {
            generation: { increment: 1 },
            status: 'PENDING',
            phase: 'PREPARE',
            lastError: null,
          },
        });
        if (this.provisionerQueue) {
          const isoJobId = `data-isolation:${tenantId}:generation:${dp.generation}`;
          await this.provisionerQueue.add(
            'reconcile-data-isolation',
            {
              apiVersion: 'organator.io/v1alpha1',
              tenantId,
              generation: dp.generation,
              desiredMode: defaultMode,
              actorId,
            },
            {
              jobId: bullJobId(isoJobId),
              attempts: 5,
              backoff: { type: 'exponential', delay: 1000 },
            },
          );
        }
      }
    }

    return {
      ...result,
      migration: { jobId: job?.id, status: 'QUEUED', idempotencyKey },
    };
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
    return this.prisma.tenantMembership.findMany({
      where: { userId, status: 'active' },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async resolveMembership(userId: string, slug: string) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { userId, status: 'active', tenant: { slug } },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            status: true,
            state: true,
          },
        },
      },
    });
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
    return this.beginOffboarding(tenantId, {
      reason: (opts.reason as string) || 'manual.admin',
      actorId: (opts.actorId as string) || null,
      actorEmail: (opts.actorEmail as string) || null,
    });
  }

  /**
   * Início do offboarding: bloqueia o acesso na hora (estado offboarding,
   * auditado) e encerra a cobrança. Falha no Stripe não impede o offboarding,
   * mas fica no audit log para cancelamento manual.
   */
  private async beginOffboarding(
    tenantId: string,
    opts: {
      reason: string;
      actorId?: string | null;
      actorEmail?: string | null;
    },
  ) {
    const tenant = await this.ensureTenantExists(tenantId);
    const updated = await this.lifecycleService.markOffboarding(tenantId, opts);
    try {
      const canceled = await cancelCustomerSubscriptions(tenant.stripeId);
      if (canceled.length) {
        await this.auditService.record({
          actorId: opts.actorId ?? null,
          action: 'tenant.billing_canceled',
          resourceType: 'Tenant',
          resourceId: tenantId,
          changes: { subscriptions: canceled },
        });
      }
    } catch (err) {
      await this.auditService.record({
        actorId: opts.actorId ?? null,
        action: 'tenant.billing_cancel_failed',
        resourceType: 'Tenant',
        resourceId: tenantId,
        changes: { customer: tenant.stripeId, error: (err as Error).message },
      });
    }
    return updated;
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

  /**
   * Membros do tenant: quem tem o tenant como origem (papel em `user.role`) e
   * quem entrou por membership, ex. convite (papel em `membership.role`).
   */
  async getMembers(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { tenantId },
          { memberships: { some: { tenantId, status: 'active' } } },
        ],
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        createdAt: true,
        memberships: {
          where: { tenantId, status: 'active' },
          select: { role: true },
        },
      },
    });
    return users.map(({ tenantId: home, memberships, role, ...user }) => ({
      ...user,
      role: home === tenantId ? role : (memberships[0]?.role ?? role),
    }));
  }

  /** Membro do tenant (origem ou membership ativa), com o papel nele. */
  private async findMember(tenantId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const membership = user
      ? await this.prisma.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId, userId } },
        })
      : null;
    const isHome = user?.tenantId === tenantId;
    const activeMembership =
      membership && membership.status === 'active' ? membership : null;
    if (!user || (!isHome && !activeMembership)) {
      throw new NotFoundException('Member not found in tenant');
    }
    const role = isHome ? user.role : activeMembership!.role;
    return { user, membership: activeMembership, isHome, role };
  }

  /** OWNERs do tenant, pelos dois caminhos (origem ou membership). */
  private countOwners(tenantId: string) {
    return this.prisma.user.count({
      where: {
        OR: [
          { tenantId, role: 'OWNER' },
          {
            memberships: {
              some: { tenantId, role: 'OWNER', status: 'active' },
            },
          },
        ],
      },
    });
  }

  async addMember(
    tenantId: string,
    email: string,
    name?: string,
    role: string = 'MEMBER',
    password?: string,
    opts: {
      actorId?: string;
      actorEmail?: string;
      ip?: string;
      actorRole?: string;
    } = {},
  ) {
    const normalizedRole = String(role || 'MEMBER').toUpperCase();
    // Sem esta checagem um OWNER/ADMIN de tenant criava um PLATFORM_ADMIN com
    // a senha que quisesse.
    if (!canAssignRole(opts.actorRole, normalizedRole)) {
      throw new ForbiddenException(
        `Você não pode atribuir o papel ${normalizedRole}`,
      );
    }
    if (password !== undefined && password.length < 8) {
      throw new BadRequestException('A senha deve ter no mínimo 8 caracteres');
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(
        'Este e-mail já tem conta. Envie um convite para adicioná-lo ao tenant.',
      );
    }

    const rawPassword =
      password || crypto.randomBytes(16).toString('base64url');
    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    const member = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        name: name || null,
        role: normalizedRole,
        password: hashedPassword,
        mustChangePassword: true,
        memberships: {
          create: { tenantId, role: normalizedRole, status: 'active' },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
    // Sem senha definida pelo admin, o membro recebe o link para criar a sua.
    if (!password) await this.passwordReset?.sendActivation(member.id);

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
    opts: {
      actorId?: string;
      actorEmail?: string;
      ip?: string;
      actorRole?: string;
    } = {},
  ) {
    const {
      user,
      membership,
      isHome,
      role: currentRole,
    } = await this.findMember(tenantId, userId);

    const normalizedRole = String(role).toUpperCase();
    if (PLATFORM_ONLY_ROLES.includes(normalizedRole)) {
      throw new BadRequestException(
        'PLATFORM_ADMIN não pode ser atribuído via gestão de membros',
      );
    }
    // Promover acima do próprio alcance (ADMIN -> OWNER) ou mexer em quem está
    // acima (ADMIN rebaixando um OWNER) também é escalada de privilégio.
    if (
      !canAssignRole(opts.actorRole, normalizedRole) ||
      !canAssignRole(opts.actorRole, currentRole)
    ) {
      throw new ForbiddenException(
        `Você não pode alterar este membro para ${normalizedRole}`,
      );
    }

    // O papel vale onde é lido: user.role no login (tenant de origem) e
    // membership.role ao trocar de tenant.
    if (membership) {
      await this.prisma.tenantMembership.update({
        where: { id: membership.id },
        data: { role: normalizedRole },
      });
    }
    const safeSelect = {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    };
    const updated = isHome
      ? await this.prisma.user.update({
          where: { id: userId },
          data: { role: normalizedRole },
          select: safeSelect,
        })
      : {
          id: user.id,
          email: user.email,
          name: user.name,
          role: normalizedRole,
          createdAt: user.createdAt,
        };

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
        from: currentRole,
        to: normalizedRole,
      },
    });

    return updated;
  }

  /**
   * Tira o usuário do tenant. A conta só é apagada se ele não pertence a
   * nenhum outro tenant; senão perde só o acesso a este (membership removida,
   * tenant de origem movido para outro) e as sessões neste tenant caem.
   */
  async removeMember(
    tenantId: string,
    userId: string,
    opts: { actorId?: string; actorEmail?: string; ip?: string } = {},
  ) {
    const { user, isHome, role } = await this.findMember(tenantId, userId);

    if (role === 'OWNER' && (await this.countOwners(tenantId)) <= 1) {
      throw new BadRequestException(
        'Não é possível remover o único OWNER do tenant',
      );
    }

    const others = await this.prisma.tenantMembership.findMany({
      where: { userId, status: 'active', tenantId: { not: tenantId } },
      orderBy: { createdAt: 'asc' },
    });

    let accountDeleted = false;
    if (isHome && others.length === 0) {
      await this.prisma.user.delete({ where: { id: userId } });
      accountDeleted = true;
    } else {
      await this.prisma.$transaction([
        this.prisma.tenantMembership.deleteMany({
          where: { tenantId, userId },
        }),
        ...(isHome
          ? [
              this.prisma.user.update({
                where: { id: userId },
                data: { tenantId: others[0].tenantId, role: others[0].role },
              }),
            ]
          : []),
        this.prisma.userSession.updateMany({
          where: { userId, tenantId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
    }

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      ip: opts.ip ?? null,
      action: 'tenant.member.removed',
      resourceType: 'TenantMember',
      resourceId: userId,
      changes: { tenantId, email: user.email, role, accountDeleted },
    });

    // Nunca devolver o registro do usuário: ele contém o hash da senha.
    return { id: user.id, email: user.email, removed: true, accountDeleted };
  }

  async triggerBackup(tenantId: string) {
    if (!this.provisionerQueue)
      throw new BadRequestException('Provisioner queue not configured');
    const job = await this.provisionerQueue.add('backup-tenant-infra', {
      tenantId,
    });
    return { jobId: job.id, status: 'QUEUED' };
  }

  async getBackups(tenantId: string) {
    return this.prisma.tenantBackup.findMany({ where: { tenantId } });
  }

  async triggerRestore(tenantId: string, backupId: string) {
    if (!this.provisionerQueue)
      throw new BadRequestException('Provisioner queue not configured');
    const job = await this.provisionerQueue.add('restore-tenant-infra', {
      tenantId,
      backupId,
    });
    return { jobId: job.id, status: 'QUEUED' };
  }

  async triggerClone(tenantId: string, targetSlug: string, targetName: string) {
    if (!this.provisionerQueue)
      throw new BadRequestException('Provisioner queue not configured');
    const job = await this.provisionerQueue.add('clone-tenant-environment', {
      tenantId,
      targetSlug,
      targetName,
    });
    return { jobId: job.id, status: 'QUEUED' };
  }

  /**
   * Offboarding completo: acesso bloqueado e cobrança encerrada agora; o worker
   * faz o backup final, remove a infraestrutura e conclui em "deleted".
   */
  async triggerOffboard(tenantId: string, actorId?: string) {
    if (!this.provisionerQueue)
      throw new BadRequestException('Provisioner queue not configured');
    const tenant = await this.ensureTenantExists(tenantId);
    await this.beginOffboarding(tenantId, {
      reason: 'manual.offboard',
      actorId: actorId ?? null,
    });
    const job = await this.provisionerQueue.add(
      'offboard-tenant-infra',
      { tenantId, slug: tenant.slug, actorId: actorId ?? null },
      // Um offboarding por tenant: cliques repetidos não enfileiram outro.
      { jobId: bullJobId(`offboard-tenant-infra:${tenantId}`) },
    );
    return { jobId: job.id, status: 'QUEUED' };
  }

  async getEnvironments(tenantId: string) {
    return this.prisma.tenantEnvironment.findMany({ where: { tenantId } });
  }

  async upsertEnvironment(tenantId: string, data: any) {
    return this.prisma.tenantEnvironment.upsert({
      where: { tenantId_type: { tenantId, type: data.type || 'PRODUCTION' } },
      create: {
        tenantId,
        name: data.name || 'Production',
        type: data.type || 'PRODUCTION',
        envVars: data.envVars || {},
      },
      update: { envVars: data.envVars || {} },
    });
  }

  async promoteEnvironment(tenantId: string, sourceEnvId: string) {
    if (!this.provisionerQueue)
      throw new BadRequestException('Provisioner queue not configured');
    const job = await this.provisionerQueue.add('promote-tenant-environment', {
      tenantId,
      sourceEnvId,
    });
    return { jobId: job.id, status: 'QUEUED' };
  }

  async getTenantHealth(tenantId: string) {
    return this.prisma.tenantHealth.findFirst({
      where: { tenantId },
      orderBy: { checkedAt: 'desc' },
    });
  }

  async getHealthSummary() {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, name: true, slug: true },
    });
    const summary = await Promise.all(
      tenants.map(async (t) => {
        const health = await this.getTenantHealth(t.id);
        return { tenant: t, health };
      }),
    );
    return summary;
  }

  /** Situação da fila do provisioner (contagens reais do BullMQ). */
  async getProvisionerTelemetry() {
    const circuits = await this.prisma.providerCircuitBreaker.findMany();
    const counts = this.provisionerQueue
      ? await this.provisionerQueue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'completed',
          'failed',
        )
      : {};
    return {
      queueAvailable: Boolean(this.provisionerQueue),
      waitingJobs: counts.waiting ?? 0,
      activeJobs: counts.active ?? 0,
      delayedJobs: counts.delayed ?? 0,
      completedJobs: counts.completed ?? 0,
      failedJobs: counts.failed ?? 0,
      circuitBreakers: circuits,
    };
  }

  async resetCircuitBreaker(provider: string) {
    return this.prisma.providerCircuitBreaker.upsert({
      where: { provider },
      create: { provider, state: 'CLOSED', failureCount: 0 },
      update: {
        state: 'CLOSED',
        failureCount: 0,
        lastFailureAt: null,
        nextAttemptAt: null,
      },
    });
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

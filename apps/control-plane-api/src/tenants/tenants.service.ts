import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

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
  ) {}

  async createTenant(name: string, plan?: string, adminEmail?: string) {
    const slug = normalizeSlug(name);
    let admin: { id: string } | null = null;
    if (adminEmail) {
      admin = await this.prisma.user.findUnique({
        where: { email: adminEmail },
      });
    }

    return this.prisma.tenant.create({
      data: {
        name,
        slug,
        plan: plan || 'free',
        status: 'active',
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

  async changePlan(tenantId: string, plan: string) {
    await this.ensureTenantExists(tenantId);

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

    return result;
  }

  async setTenantStatus(tenantId: string, status: TenantStatus) {
    await this.ensureTenantExists(tenantId);
    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`,
      );
    }
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status },
    });
  }

  async suspendTenant(tenantId: string) {
    return this.setTenantStatus(tenantId, 'suspended');
  }

  async reactivateTenant(tenantId: string) {
    return this.setTenantStatus(tenantId, 'active');
  }

  async archiveTenant(tenantId: string) {
    return this.setTenantStatus(tenantId, 'archived');
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
  ) {
    const rawPassword =
      password || crypto.randomBytes(16).toString('base64url');
    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    return this.prisma.user.create({
      data: {
        tenantId,
        email,
        name: name || null,
        role: role || 'MEMBER',
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
  }

  async updateMemberRole(tenantId: string, userId: string, role: string) {
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

    return this.prisma.user.update({
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
  }

  async removeMember(tenantId: string, userId: string) {
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

    return this.prisma.user.delete({
      where: { id: userId },
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

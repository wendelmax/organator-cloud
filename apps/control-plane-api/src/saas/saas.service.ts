import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaResourceType, QUOTA_RESOURCES } from './quota.decorator';

export interface PlanLimits {
  MICROSERVICE: number;
  DEPLOYMENT: number;
  SEATS: number;
  APIS: number;
  DOMAINS: number;
  GB_STORAGE: number;
}

export const DEFAULT_FREE_LIMITS: PlanLimits = {
  MICROSERVICE: 2,
  DEPLOYMENT: 5,
  SEATS: 3,
  APIS: 5,
  DOMAINS: 1,
  GB_STORAGE: 1,
};

// Fallback legado enquanto o plano não estiver registrado no BillingPlan.
// -1 representa ilimitado.
export const PLAN_LIMITS: Record<string, Partial<PlanLimits>> = {
  free: DEFAULT_FREE_LIMITS,
  pro: {
    MICROSERVICE: 20,
    DEPLOYMENT: 100,
    SEATS: 20,
    APIS: 50,
    DOMAINS: 10,
    GB_STORAGE: 100,
  },
  enterprise: {
    MICROSERVICE: -1,
    DEPLOYMENT: -1,
    SEATS: -1,
    APIS: -1,
    DOMAINS: -1,
    GB_STORAGE: -1,
  },
};

@Injectable()
export class SaasService {
  constructor(private readonly prisma: PrismaService) {}

  async checkQuota(
    tenantId: string,
    resourceType: QuotaResourceType,
  ): Promise<void> {
    if (!tenantId) {
      return;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    const planKey = (tenant?.plan || 'free').toLowerCase();

    const storedPlan = await this.prisma.billingPlan.findUnique({
      where: { slug: planKey },
    });

    const limits = this.resolveLimits(
      (storedPlan?.quotas as Record<string, number> | null) || null,
      planKey,
    );

    const maxLimit = limits[resourceType];
    if (maxLimit === -1) {
      return;
    }

    const currentUsage = await this.usageFor(resourceType, tenantId);

    if (currentUsage >= maxLimit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'QUOTA_EXCEEDED',
          message: 'Limite do plano atingido. Faça upgrade para continuar.',
          plan: planKey,
          resource: resourceType,
          limit: maxLimit,
          usage: currentUsage,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  private resolveLimits(
    stored: Record<string, number> | null,
    planKey: string,
  ): PlanLimits {
    const legacy = PLAN_LIMITS[planKey] || DEFAULT_FREE_LIMITS;
    const limits: PlanLimits = { ...DEFAULT_FREE_LIMITS };

    for (const resource of QUOTA_RESOURCES) {
      if (legacy[resource] !== undefined) {
        limits[resource] = legacy[resource];
      }
    }

    if (stored) {
      for (const resource of QUOTA_RESOURCES) {
        if (stored[resource] !== undefined) {
          limits[resource] = stored[resource];
        }
      }
    }

    return limits;
  }

  private async usageFor(
    resourceType: QuotaResourceType,
    tenantId: string,
  ): Promise<number> {
    switch (resourceType) {
      case 'MICROSERVICE':
        return this.prisma.microservice.count({ where: { tenantId } });
      case 'DEPLOYMENT': {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return this.prisma.deployment.count({
          where: {
            microservice: { tenantId },
            createdAt: { gte: startOfMonth },
          },
        });
      }
      case 'SEATS':
        return this.prisma.user.count({ where: { tenantId } });
      case 'APIS':
        return this.prisma.apiDoc.count({
          where: { microservice: { tenantId } },
        });
      case 'DOMAINS':
      case 'GB_STORAGE':
        return 0;
      default:
        return 0;
    }
  }
}

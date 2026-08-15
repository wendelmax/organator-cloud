import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  QuotaResourceType,
  LimitType,
  TenantEntitlements,
  QUOTA_RESOURCES,
} from './entitlement.types';

const DEFAULT_FREE_QUOTAS: Record<string, number> = {
  MICROSERVICE: 2,
  DEPLOYMENT: 5,
  SEATS: 3,
  APIS: 5,
  DOMAINS: 1,
  GB_STORAGE: 1,
};

// Fallback legado enquanto o plano não estiver registrado no BillingPlan.
const LEGACY_PLAN_LIMITS: Record<string, Partial<Record<string, number>>> = {
  free: DEFAULT_FREE_QUOTAS,
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

const DEFAULT_LIMIT_TYPE: LimitType = 'hard';

const CACHE_TTL_MS = Number(process.env.ENTITLEMENTS_CACHE_TTL_MS) || 5000;

interface CacheEntry {
  value: TenantEntitlements;
  expiresAt: number;
}

@Injectable()
export class EntitlementsService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve o conjunto efetivo de entitlements do tenant a partir do plano ativo
   * + overrides por tenant, com cache curto (TTL).
   */
  async resolve(tenantId: string): Promise<TenantEntitlements> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await this.resolveFromDb(tenantId);
    this.cache.set(tenantId, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return value;
  }

  private async resolveFromDb(tenantId: string): Promise<TenantEntitlements> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, plan: true },
    });

    const planKey = (tenant?.plan || 'free').toLowerCase();

    const [billingPlan, override] = await Promise.all([
      this.prisma.billingPlan.findUnique({ where: { slug: planKey } }),
      this.prisma.tenantEntitlementOverride.findUnique({
        where: { tenantId },
      }),
    ]);

    const planQuotas = (billingPlan?.quotas as Record<string, number>) || {};
    const planFeatures =
      (billingPlan?.features as Record<string, boolean>) || {};
    const planLimitTypes =
      (billingPlan?.limitTypes as Record<string, LimitType>) || {};
    const overrideQuotas = (override?.quotas as Record<string, number>) || {};
    const overrideFeatures =
      (override?.features as Record<string, boolean>) || {};
    const overrideLimits =
      (override?.limits as Record<string, LimitType>) || {};

    const quotas: Record<string, number> = {};
    for (const resource of QUOTA_RESOURCES) {
      const base =
        planQuotas[resource] ??
        LEGACY_PLAN_LIMITS[planKey]?.[resource] ??
        DEFAULT_FREE_QUOTAS[resource];
      quotas[resource] =
        overrideQuotas[resource] !== undefined
          ? overrideQuotas[resource]
          : base;
    }

    const features: Record<string, boolean> = {
      ...planFeatures,
      ...overrideFeatures,
    };

    const limits: Record<string, LimitType> = {};
    for (const resource of QUOTA_RESOURCES) {
      limits[resource] =
        overrideLimits[resource] ||
        planLimitTypes[resource] ||
        DEFAULT_LIMIT_TYPE;
    }

    return {
      tenantId,
      plan: planKey,
      quotas,
      features,
      limits,
      computedAt: new Date(),
    };
  }

  /**
   * Lança 402 (PAYMENT_REQUIRED) quando o tenant estourou a cota do recurso.
   * O body inclui a cota, o uso e o tipo de limite (soft/hard).
   */
  async checkQuota(
    tenantId: string,
    resource: QuotaResourceType,
  ): Promise<void> {
    if (!tenantId) {
      return;
    }

    const entitlements = await this.resolve(tenantId);

    const limit = entitlements.quotas[resource];
    if (limit === undefined || limit === -1) {
      return;
    }

    const usage = await this.usageFor(resource, tenantId);
    if (usage < limit) {
      return;
    }

    const limitType = entitlements.limits[resource] || DEFAULT_LIMIT_TYPE;
    if (limitType === 'soft') {
      return;
    }
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'QUOTA_EXCEEDED',
        message: 'Limite do plano atingido. Faça upgrade para continuar.',
        plan: entitlements.plan,
        resource,
        limit,
        usage,
        limitType,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  /**
   * Lança 403 quando a feature não está habilitada no plano efetivo do tenant.
   */
  async requireFeature(tenantId: string, feature: string): Promise<void> {
    if (!tenantId) {
      return;
    }

    const entitlements = await this.resolve(tenantId);

    if (entitlements.features[feature] !== true) {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          code: 'FEATURE_NOT_ENABLED',
          message: 'Recurso não disponível no plano atual.',
          plan: entitlements.plan,
          feature,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /** Invalida o cache do tenant (chamar após mudança de plano/pagamento). */
  bust(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  bustAll(): void {
    this.cache.clear();
  }

  private async usageFor(
    resource: QuotaResourceType,
    tenantId: string,
  ): Promise<number> {
    switch (resource) {
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

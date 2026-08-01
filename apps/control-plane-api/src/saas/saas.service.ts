import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaResourceType } from './quota.decorator';

export interface PlanLimits {
  MICROSERVICE: number;
  DEPLOYMENT: number;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    MICROSERVICE: 2,
    DEPLOYMENT: 5,
  },
  pro: {
    MICROSERVICE: 20,
    DEPLOYMENT: 100,
  },
  enterprise: {
    MICROSERVICE: Infinity,
    DEPLOYMENT: Infinity,
  },
};

@Injectable()
export class SaasService {
  constructor(private readonly prisma: PrismaService) {}

  async checkQuota(tenantId: string, resourceType: QuotaResourceType): Promise<void> {
    if (!tenantId) {
      return;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    const planKey = (tenant?.plan || 'free').toLowerCase();
    const limits = PLAN_LIMITS[planKey] || PLAN_LIMITS.free;
    const maxLimit = limits[resourceType];

    if (maxLimit === Infinity) {
      return;
    }

    let currentUsage = 0;

    if (resourceType === 'MICROSERVICE') {
      currentUsage = await this.prisma.microservice.count({
        where: { tenantId },
      });
    } else if (resourceType === 'DEPLOYMENT') {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      currentUsage = await this.prisma.deployment.count({
        where: {
          microservice: {
            tenantId,
          },
          createdAt: {
            gte: startOfMonth,
          },
        },
      });
    }

    if (currentUsage >= maxLimit) {
      throw new HttpException(
        'Limite do plano atingido. Faça upgrade para continuar.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }
}

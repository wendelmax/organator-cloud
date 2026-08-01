import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QUOTA_KEY, QuotaResourceType } from './quota.decorator';
import { SaasService } from './saas.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly saasService: SaasService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resourceType = this.reflector.getAllAndOverride<QuotaResourceType>(
      QUOTA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!resourceType) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    let tenantId =
      request.user?.tenantId ||
      request.body?.tenantId ||
      request.params?.tenantId;

    if (!tenantId && request.params?.id) {
      const service = await this.prisma.microservice.findUnique({
        where: { id: request.params.id },
        select: { tenantId: true },
      });
      if (service) {
        tenantId = service.tenantId;
      }
    }

    if (tenantId) {
      await this.saasService.checkQuota(tenantId, resourceType);
    }

    return true;
  }
}

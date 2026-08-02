import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from './entitlements.service';
import { extractTenantId } from './request-tenant.util';
import { FEATURE_KEY } from './require-feature.decorator';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!feature) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantId = await extractTenantId(request, this.prisma);
    if (tenantId) {
      await this.entitlements.requireFeature(tenantId, feature);
    }

    return true;
  }
}

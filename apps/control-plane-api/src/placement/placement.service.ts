import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface PlacementRequest {
  tenantId: string;
  provider: string;
  region: string;
}

@Injectable()
export class PlacementService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async validate(request: PlacementRequest) {
    const policy = await this.prisma.tenantPlacementPolicy.findUnique({
      where: { tenantId: request.tenantId },
      include: { region: true },
    });
    const catalog = await this.prisma.regionCatalog.findUnique({
      where: { provider_region: { provider: request.provider, region: request.region } },
    });
    if (!catalog || catalog.status !== 'available' || catalog.capacity <= 0) {
      await this.audit.record({ action: 'tenant.placement_rejected', resourceType: 'Tenant', resourceId: request.tenantId, changes: { provider: request.provider, region: request.region, reason: 'region_unavailable' } });
      throw new ConflictException('Região ou provedor indisponível para provisionamento');
    }
    if (policy?.regionId && policy.regionId !== catalog.id) {
      await this.audit.record({ action: 'tenant.placement_rejected', resourceType: 'Tenant', resourceId: request.tenantId, changes: { provider: request.provider, region: request.region, reason: 'region_policy' } });
      throw new ConflictException('Região incompatível com a política do tenant');
    }
    const providers = Array.isArray(policy?.allowedProviders) ? policy.allowedProviders : [];
    if (providers.length > 0 && !providers.includes(request.provider)) {
      throw new ConflictException('Provedor incompatível com a política do tenant');
    }
    if (policy?.residencyRequired && policy.residencyRequired !== catalog.residency) {
      throw new ConflictException('Residência de dados incompatível com a política do tenant');
    }
    return catalog;
  }

  async setPolicy(tenantId: string, input: { provider?: string; region?: string; residencyRequired?: string; allowedProviders?: string[] }, actorId: string) {
    const region = input.provider && input.region ? await this.prisma.regionCatalog.findUnique({ where: { provider_region: { provider: input.provider, region: input.region } } }) : null;
    if (input.provider && input.region && !region) throw new NotFoundException('Região não cadastrada');
    const result = await this.prisma.tenantPlacementPolicy.upsert({
      where: { tenantId },
      create: { tenantId, regionId: region?.id, residencyRequired: input.residencyRequired, allowedProviders: input.allowedProviders ?? [] },
      update: { regionId: region?.id, residencyRequired: input.residencyRequired, allowedProviders: input.allowedProviders ?? [] },
    });
    await this.audit.record({ actorId, action: 'tenant.placement_policy_changed', resourceType: 'Tenant', resourceId: tenantId, changes: { regionId: region?.id, residencyRequired: input.residencyRequired, allowedProviders: input.allowedProviders ?? [] } });
    return result;
  }

  async planMigration(tenantId: string, toRegionId: string, actorId: string) {
    const target = await this.prisma.regionCatalog.findUnique({ where: { id: toRegionId } });
    if (!target || target.status !== 'available') throw new BadRequestException('Região de destino indisponível');
    const policy = await this.prisma.tenantPlacementPolicy.findUnique({ where: { tenantId } });
    if (policy?.regionId === toRegionId) throw new BadRequestException('Tenant já está na região de destino');
    const migration = await this.prisma.tenantPlacementMigration.create({ data: { tenantId, fromRegionId: policy?.regionId, toRegionId, approvedBy: actorId, status: 'planned', rollbackPlan: { backupRequired: true, restoreTarget: policy?.regionId ?? null }, affectedData: { tenantId } } });
    await this.audit.record({ actorId, action: 'tenant.placement_migration_planned', resourceType: 'TenantPlacementMigration', resourceId: migration.id, changes: { tenantId, toRegionId } });
    return migration;
  }
}

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PlacementService } from './placement.service';

describe('PlacementService — policy rules and migrations', () => {
  const region = {
    id: 'eu-1',
    status: 'available',
    capacity: 5,
    residency: 'EU',
  };
  let prisma: any;
  let audit: any;
  let service: PlacementService;

  beforeEach(() => {
    prisma = {
      tenantPlacementPolicy: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn((args) =>
          Promise.resolve({ tenantId: args.where.tenantId, ...args.create }),
        ),
      },
      regionCatalog: { findUnique: jest.fn().mockResolvedValue(region) },
      tenantPlacementMigration: {
        create: jest.fn((args) =>
          Promise.resolve({ id: 'mig-1', ...args.data }),
        ),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new PlacementService(prisma, audit);
  });

  const req = { tenantId: 't1', provider: 'AWS', region: 'eu-west-1' };

  describe('validate', () => {
    it('accepts an available region when the tenant has no policy', async () => {
      await expect(service.validate(req)).resolves.toBe(region);
    });

    it('rejects when the region is missing from the catalog and audits the reason', async () => {
      prisma.regionCatalog.findUnique.mockResolvedValue(null);
      await expect(service.validate(req)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.placement_rejected',
          changes: expect.objectContaining({ reason: 'region_unavailable' }),
        }),
      );
    });

    it('rejects regions with no remaining capacity', async () => {
      prisma.regionCatalog.findUnique.mockResolvedValue({
        ...region,
        capacity: 0,
      });
      await expect(service.validate(req)).rejects.toThrow('indisponível');
    });

    it('audits region policy mismatches', async () => {
      prisma.tenantPlacementPolicy.findUnique.mockResolvedValue({
        regionId: 'us-1',
      });
      await expect(service.validate(req)).rejects.toThrow('política do tenant');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: expect.objectContaining({ reason: 'region_policy' }),
        }),
      );
    });

    it('enforces the allowed providers list', async () => {
      prisma.tenantPlacementPolicy.findUnique.mockResolvedValue({
        allowedProviders: ['GCP'],
      });
      await expect(service.validate(req)).rejects.toThrow(
        'Provedor incompatível',
      );

      prisma.tenantPlacementPolicy.findUnique.mockResolvedValue({
        allowedProviders: ['GCP', 'AWS'],
      });
      await expect(service.validate(req)).resolves.toBe(region);
    });

    it('enforces data residency', async () => {
      prisma.tenantPlacementPolicy.findUnique.mockResolvedValue({
        residencyRequired: 'BR',
      });
      await expect(service.validate(req)).rejects.toThrow(
        'Residência de dados',
      );

      prisma.tenantPlacementPolicy.findUnique.mockResolvedValue({
        residencyRequired: 'EU',
        regionId: 'eu-1',
      });
      await expect(service.validate(req)).resolves.toBe(region);
    });
  });

  describe('setPolicy', () => {
    it('fails when provider+region are not in the catalog', async () => {
      prisma.regionCatalog.findUnique.mockResolvedValue(null);
      await expect(
        service.setPolicy('t1', { provider: 'AWS', region: 'mars-1' }, 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.tenantPlacementPolicy.upsert).not.toHaveBeenCalled();
    });

    it('upserts the policy pinned to the region and audits', async () => {
      const policy = await service.setPolicy(
        't1',
        {
          provider: 'AWS',
          region: 'eu-west-1',
          residencyRequired: 'EU',
          allowedProviders: ['AWS'],
        },
        'u1',
      );
      expect(policy).toMatchObject({
        regionId: 'eu-1',
        residencyRequired: 'EU',
        allowedProviders: ['AWS'],
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.placement_policy_changed',
          actorId: 'u1',
        }),
      );
    });

    it('allows a residency-only policy without pinning a region', async () => {
      await service.setPolicy('t1', { residencyRequired: 'BR' }, 'u1');
      expect(prisma.regionCatalog.findUnique).not.toHaveBeenCalled();
      expect(prisma.tenantPlacementPolicy.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            regionId: undefined,
            allowedProviders: [],
          }),
        }),
      );
    });
  });

  describe('planMigration', () => {
    it('rejects unavailable targets', async () => {
      prisma.regionCatalog.findUnique.mockResolvedValue({
        ...region,
        status: 'degraded',
      });
      await expect(
        service.planMigration('t1', 'eu-1', 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects migrating to the current region', async () => {
      prisma.tenantPlacementPolicy.findUnique.mockResolvedValue({
        regionId: 'eu-1',
      });
      await expect(service.planMigration('t1', 'eu-1', 'u1')).rejects.toThrow(
        'já está na região',
      );
    });

    it('plans a migration with a rollback plan pointing to the source region', async () => {
      prisma.tenantPlacementPolicy.findUnique.mockResolvedValue({
        regionId: 'us-1',
      });
      const migration = await service.planMigration('t1', 'eu-1', 'u1');
      expect(migration).toMatchObject({
        fromRegionId: 'us-1',
        toRegionId: 'eu-1',
        status: 'planned',
        approvedBy: 'u1',
        rollbackPlan: { backupRequired: true, restoreTarget: 'us-1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.placement_migration_planned',
        }),
      );
    });
  });
});

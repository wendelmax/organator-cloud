import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EntitlementsService', () => {
  let service: EntitlementsService;

  const mockPrisma = {
    tenant: {
      findUnique: jest.fn(),
    },
    billingPlan: {
      findUnique: jest.fn(),
    },
    tenantEntitlementOverride: {
      findUnique: jest.fn(),
    },
    microservice: {
      count: jest.fn(),
    },
    deployment: {
      count: jest.fn(),
    },
    user: {
      count: jest.fn(),
    },
    apiDoc: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitlementsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EntitlementsService>(EntitlementsService);
    service.bustAll();
    jest.clearAllMocks();
  });

  function mockPlanData(overrides: any = {}) {
    return {
      quotas: {
        MICROSERVICE: 2,
        DEPLOYMENT: 5,
        SEATS: 3,
        APIS: 5,
        DOMAINS: 1,
        GB_STORAGE: 1,
      },
      features: { api_keys: true, audit_logs: false },
      limitTypes: { SEATS: 'soft' },
      ...overrides,
    };
  }

  describe('resolve', () => {
    it('resolves entitlements from the tenant plan', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue(mockPlanData());
      mockPrisma.tenantEntitlementOverride.findUnique.mockResolvedValue(null);

      const result = await service.resolve('tenant-1');

      expect(result).toMatchObject({
        tenantId: 'tenant-1',
        plan: 'free',
        quotas: {
          MICROSERVICE: 2,
          DEPLOYMENT: 5,
          SEATS: 3,
          APIS: 5,
          DOMAINS: 1,
          GB_STORAGE: 1,
        },
        features: { api_keys: true, audit_logs: false },
      });
      expect(result.limits.SEATS).toBe('soft');
      expect(result.limits.MICROSERVICE).toBe('hard');
    });

    it('applies tenant override without changing the plan', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue(
        mockPlanData({ limitTypes: {} }),
      );
      mockPrisma.tenantEntitlementOverride.findUnique.mockResolvedValue({
        quotas: { MICROSERVICE: 10 },
        features: { audit_logs: true },
        limits: { MICROSERVICE: 'soft' },
      });

      const result = await service.resolve('tenant-1');

      expect(result.plan).toBe('free');
      expect(result.quotas.MICROSERVICE).toBe(10);
      expect(result.features.audit_logs).toBe(true);
      expect(result.limits.MICROSERVICE).toBe('soft');
    });

    it('falls back to legacy plan limits when BillingPlan has no quotas', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'enterprise',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue(null);
      mockPrisma.tenantEntitlementOverride.findUnique.mockResolvedValue(null);

      const result = await service.resolve('tenant-1');

      expect(result.quotas.MICROSERVICE).toBe(-1);
      expect(result.quotas.DOMAINS).toBe(-1);
    });

    it('caches results within TTL and resolves fresh after bust', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue(
        mockPlanData({ limitTypes: {} }),
      );
      mockPrisma.tenantEntitlementOverride.findUnique.mockResolvedValue(null);

      const first = await service.resolve('tenant-1');
      const second = await service.resolve('tenant-1');

      expect(second).toBe(first);
      expect(mockPrisma.tenant.findUnique).toHaveBeenCalledTimes(1);

      service.bust('tenant-1');
      await service.resolve('tenant-1');
      expect(mockPrisma.tenant.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkQuota', () => {
    it('throws 402 with quota, usage and limitType when limit reached', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue(
        mockPlanData({ limitTypes: {} }),
      );
      mockPrisma.tenantEntitlementOverride.findUnique.mockResolvedValue(null);
      mockPrisma.microservice.count.mockResolvedValue(2);

      await expect(
        service.checkQuota('tenant-1', 'MICROSERVICE'),
      ).rejects.toThrow(HttpException);

      const error = await service
        .checkQuota('tenant-1', 'MICROSERVICE')
        .catch((e) => e);
      const body = error.getResponse();
      expect(body.code).toBe('QUOTA_EXCEEDED');
      expect(body.statusCode).toBe(402);
      expect(body.resource).toBe('MICROSERVICE');
      expect(body.limit).toBe(2);
      expect(body.usage).toBe(2);
      expect(body.limitType).toBe('hard');
    });

    it('allows usage below the limit', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue(
        mockPlanData({ limitTypes: {} }),
      );
      mockPrisma.tenantEntitlementOverride.findUnique.mockResolvedValue(null);
      mockPrisma.microservice.count.mockResolvedValue(1);

      await expect(
        service.checkQuota('tenant-1', 'MICROSERVICE'),
      ).resolves.toBeUndefined();
    });

    it('allows unlimited (-1) resources', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'enterprise',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue(null);
      mockPrisma.tenantEntitlementOverride.findUnique.mockResolvedValue(null);

      await expect(
        service.checkQuota('tenant-1', 'MICROSERVICE'),
      ).resolves.toBeUndefined();
    });

    it('is a no-op without a tenantId', async () => {
      await expect(
        service.checkQuota(undefined as any, 'MICROSERVICE'),
      ).resolves.toBeUndefined();
      expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('requireFeature', () => {
    it('throws 403 when the feature is disabled', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue(mockPlanData());
      mockPrisma.tenantEntitlementOverride.findUnique.mockResolvedValue(null);

      await expect(
        service.requireFeature('tenant-1', 'sso_saml'),
      ).rejects.toThrow(HttpException);

      const error = await service
        .requireFeature('tenant-1', 'sso_saml')
        .catch((e) => e);
      const body = error.getResponse();
      expect(body.code).toBe('FEATURE_NOT_ENABLED');
      expect(body.statusCode).toBe(403);
      expect(body.feature).toBe('sso_saml');
    });

    it('passes when the feature is enabled', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue(mockPlanData());
      mockPrisma.tenantEntitlementOverride.findUnique.mockResolvedValue(null);

      await expect(
        service.requireFeature('tenant-1', 'api_keys'),
      ).resolves.toBeUndefined();
    });
  });
});

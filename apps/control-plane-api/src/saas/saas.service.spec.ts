import { Test, TestingModule } from '@nestjs/testing';
import { SaasService } from './saas.service';
import { PrismaService } from '../prisma/prisma.service';
import { HttpStatus } from '@nestjs/common';

describe('SaasService', () => {
  let service: SaasService;

  const mockPrismaService = {
    tenant: {
      findUnique: jest.fn(),
    },
    billingPlan: {
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

  const quotaError = (partial: Record<string, unknown> = {}) => ({
    statusCode: HttpStatus.PAYMENT_REQUIRED,
    code: 'QUOTA_EXCEEDED',
    message: 'Limite do plano atingido. Faça upgrade para continuar.',
    ...partial,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaasService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SaasService>(SaasService);
    jest.clearAllMocks();
    mockPrismaService.billingPlan.findUnique.mockResolvedValue(null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return early without queries when tenantId is missing', async () => {
    await expect(service.checkQuota('', 'MICROSERVICE')).resolves.not.toThrow();
    expect(mockPrismaService.tenant.findUnique).not.toHaveBeenCalled();
  });

  describe('checkQuota - free plan (fallback)', () => {
    beforeEach(() => {
      mockPrismaService.tenant.findUnique.mockResolvedValue({
        id: 'tenant-free',
        plan: 'free',
      });
    });

    it('should allow microservice creation if under limit (1 microservice)', async () => {
      mockPrismaService.microservice.count.mockResolvedValue(1);

      await expect(
        service.checkQuota('tenant-free', 'MICROSERVICE'),
      ).resolves.not.toThrow();
    });

    it('should throw HTTP 402 with quota details if microservice quota reached', async () => {
      mockPrismaService.microservice.count.mockResolvedValue(2);

      await expect(
        service.checkQuota('tenant-free', 'MICROSERVICE'),
      ).rejects.toMatchObject({
        status: HttpStatus.PAYMENT_REQUIRED,
        response: quotaError({
          plan: 'free',
          resource: 'MICROSERVICE',
          limit: 2,
          usage: 2,
        }),
      });
    });

    it('should allow deployment if under limit (4 deployments)', async () => {
      mockPrismaService.deployment.count.mockResolvedValue(4);

      await expect(
        service.checkQuota('tenant-free', 'DEPLOYMENT'),
      ).resolves.not.toThrow();
    });

    it('should throw HTTP 402 with quota details if deployment quota reached', async () => {
      mockPrismaService.deployment.count.mockResolvedValue(5);

      await expect(
        service.checkQuota('tenant-free', 'DEPLOYMENT'),
      ).rejects.toMatchObject({
        status: HttpStatus.PAYMENT_REQUIRED,
        response: quotaError({
          plan: 'free',
          resource: 'DEPLOYMENT',
          limit: 5,
          usage: 5,
        }),
      });
    });
  });

  describe('checkQuota - tenant without plan falls back to free', () => {
    it('should resolve free limits when tenant.plan is null', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue({
        id: 'tenant-null',
        plan: null,
      });
      mockPrismaService.user.count.mockResolvedValue(3);

      await expect(
        service.checkQuota('tenant-null', 'SEATS'),
      ).rejects.toMatchObject({
        response: quotaError({ plan: 'free', resource: 'SEATS', limit: 3 }),
      });
    });

    it('should resolve free limits when tenant.plan is unknown', async () => {
      mockPrismaService.tenant.findUnique.mockResolvedValue({
        id: 'tenant-unknown',
        plan: 'does-not-exist',
      });
      mockPrismaService.microservice.count.mockResolvedValue(2);

      await expect(
        service.checkQuota('tenant-unknown', 'MICROSERVICE'),
      ).rejects.toMatchObject({
        response: quotaError({
          plan: 'does-not-exist',
          resource: 'MICROSERVICE',
          limit: 2,
        }),
      });
    });
  });

  describe('checkQuota - pro plan (fallback)', () => {
    beforeEach(() => {
      mockPrismaService.tenant.findUnique.mockResolvedValue({
        id: 'tenant-pro',
        plan: 'pro',
      });
    });

    it('should allow up to 19 microservices', async () => {
      mockPrismaService.microservice.count.mockResolvedValue(19);

      await expect(
        service.checkQuota('tenant-pro', 'MICROSERVICE'),
      ).resolves.not.toThrow();
    });

    it('should throw HTTP 402 at 20 microservices', async () => {
      mockPrismaService.microservice.count.mockResolvedValue(20);

      await expect(
        service.checkQuota('tenant-pro', 'MICROSERVICE'),
      ).rejects.toMatchObject({
        response: quotaError({
          plan: 'pro',
          resource: 'MICROSERVICE',
          limit: 20,
          usage: 20,
        }),
      });
    });
  });

  describe('checkQuota - enterprise plan (fallback, unlimited)', () => {
    beforeEach(() => {
      mockPrismaService.tenant.findUnique.mockResolvedValue({
        id: 'tenant-enterprise',
        plan: 'enterprise',
      });
    });

    it('should allow unlimited microservices and not call count query', async () => {
      await expect(
        service.checkQuota('tenant-enterprise', 'MICROSERVICE'),
      ).resolves.not.toThrow();
      expect(mockPrismaService.microservice.count).not.toHaveBeenCalled();
    });

    it('should allow unlimited deployments and not call count query', async () => {
      await expect(
        service.checkQuota('tenant-enterprise', 'DEPLOYMENT'),
      ).resolves.not.toThrow();
      expect(mockPrismaService.deployment.count).not.toHaveBeenCalled();
    });
  });

  describe('checkQuota - quotas from BillingPlan register', () => {
    beforeEach(() => {
      mockPrismaService.tenant.findUnique.mockResolvedValue({
        id: 'tenant-custom',
        plan: 'team',
      });
      mockPrismaService.billingPlan.findUnique.mockResolvedValue({
        slug: 'team',
        quotas: {
          MICROSERVICE: 5,
          DEPLOYMENT: -1,
          SEATS: 4,
          APIS: 2,
          DOMAINS: 1,
          GB_STORAGE: 1,
        },
      });
    });

    it('should use stored quota when the plan is registered', async () => {
      mockPrismaService.microservice.count.mockResolvedValue(4);

      await expect(
        service.checkQuota('tenant-custom', 'MICROSERVICE'),
      ).resolves.not.toThrow();
    });

    it('should throw HTTP 402 when stored quota is reached', async () => {
      mockPrismaService.microservice.count.mockResolvedValue(5);

      await expect(
        service.checkQuota('tenant-custom', 'MICROSERVICE'),
      ).rejects.toMatchObject({
        response: quotaError({
          plan: 'team',
          resource: 'MICROSERVICE',
          limit: 5,
          usage: 5,
        }),
      });
    });

    it('should treat -1 stored quota as unlimited', async () => {
      await expect(
        service.checkQuota('tenant-custom', 'DEPLOYMENT'),
      ).resolves.not.toThrow();
      expect(mockPrismaService.deployment.count).not.toHaveBeenCalled();
    });

    it('should count SEATS from users and enforce the stored limit', async () => {
      mockPrismaService.user.count.mockResolvedValue(4);

      await expect(
        service.checkQuota('tenant-custom', 'SEATS'),
      ).rejects.toMatchObject({
        response: quotaError({
          plan: 'team',
          resource: 'SEATS',
          limit: 4,
          usage: 4,
        }),
      });
      expect(mockPrismaService.user.count).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-custom' },
      });
    });

    it('should count APIS from api docs and enforce the stored limit', async () => {
      mockPrismaService.apiDoc.count.mockResolvedValue(2);

      await expect(
        service.checkQuota('tenant-custom', 'APIS'),
      ).rejects.toMatchObject({
        response: quotaError({
          plan: 'team',
          resource: 'APIS',
          limit: 2,
          usage: 2,
        }),
      });
      expect(mockPrismaService.apiDoc.count).toHaveBeenCalledWith({
        where: { microservice: { tenantId: 'tenant-custom' } },
      });
    });

    it('should not block DOMAINS and GB_STORAGE (usage not tracked yet)', async () => {
      await expect(
        service.checkQuota('tenant-custom', 'DOMAINS'),
      ).resolves.not.toThrow();
      await expect(
        service.checkQuota('tenant-custom', 'GB_STORAGE'),
      ).resolves.not.toThrow();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { SaasService } from './saas.service';
import { PrismaService } from '../prisma/prisma.service';
import { HttpException, HttpStatus } from '@nestjs/common';

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
  };

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

  describe('checkQuota - free plan', () => {
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

    it('should throw HTTP 402 if microservice quota reached (2 microservices)', async () => {
      mockPrismaService.microservice.count.mockResolvedValue(2);

      await expect(
        service.checkQuota('tenant-free', 'MICROSERVICE'),
      ).rejects.toThrow(
        new HttpException(
          'Limite do plano atingido. Faça upgrade para continuar.',
          HttpStatus.PAYMENT_REQUIRED,
        ),
      );
    });

    it('should allow deployment if under limit (4 deployments)', async () => {
      mockPrismaService.deployment.count.mockResolvedValue(4);

      await expect(
        service.checkQuota('tenant-free', 'DEPLOYMENT'),
      ).resolves.not.toThrow();
    });

    it('should throw HTTP 402 if deployment quota reached (5 deployments)', async () => {
      mockPrismaService.deployment.count.mockResolvedValue(5);

      await expect(
        service.checkQuota('tenant-free', 'DEPLOYMENT'),
      ).rejects.toThrow(
        new HttpException(
          'Limite do plano atingido. Faça upgrade para continuar.',
          HttpStatus.PAYMENT_REQUIRED,
        ),
      );
    });
  });

  describe('checkQuota - pro plan', () => {
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
      ).rejects.toThrow(
        new HttpException(
          'Limite do plano atingido. Faça upgrade para continuar.',
          HttpStatus.PAYMENT_REQUIRED,
        ),
      );
    });

    it('should allow up to 99 deployments', async () => {
      mockPrismaService.deployment.count.mockResolvedValue(99);

      await expect(
        service.checkQuota('tenant-pro', 'DEPLOYMENT'),
      ).resolves.not.toThrow();
    });

    it('should throw HTTP 402 at 100 deployments', async () => {
      mockPrismaService.deployment.count.mockResolvedValue(100);

      await expect(
        service.checkQuota('tenant-pro', 'DEPLOYMENT'),
      ).rejects.toThrow(
        new HttpException(
          'Limite do plano atingido. Faça upgrade para continuar.',
          HttpStatus.PAYMENT_REQUIRED,
        ),
      );
    });
  });

  describe('checkQuota - enterprise plan', () => {
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
  });

  describe('checkQuota - quotas from BillingPlan register', () => {
    beforeEach(() => {
      mockPrismaService.tenant.findUnique.mockResolvedValue({
        id: 'tenant-custom',
        plan: 'team',
      });
      mockPrismaService.billingPlan.findUnique.mockResolvedValue({
        slug: 'team',
        quotas: { MICROSERVICE: 5, DEPLOYMENT: -1 },
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
      ).rejects.toThrow(
        new HttpException(
          'Limite do plano atingido. Faça upgrade para continuar.',
          HttpStatus.PAYMENT_REQUIRED,
        ),
      );
    });

    it('should treat -1 stored quota as unlimited (-1 deployment)', async () => {
      await expect(
        service.checkQuota('tenant-custom', 'DEPLOYMENT'),
      ).resolves.not.toThrow();
      expect(mockPrismaService.deployment.count).not.toHaveBeenCalled();
    });
  });
});

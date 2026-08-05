import { Test, TestingModule } from '@nestjs/testing';
import { BillingPlansService } from './billing-plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    products: {
      create: jest.fn().mockResolvedValue({ id: 'prod_real' }),
      update: jest.fn().mockResolvedValue({ id: 'prod_real' }),
    },
    prices: {
      create: jest.fn().mockResolvedValue({ id: 'price_real' }),
    },
  }));
});

describe('BillingPlansService', () => {
  let service: BillingPlansService;

  const mockAudit = { record: jest.fn().mockResolvedValue(undefined) };

  const mockPrismaService = {
    billingPlan: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingPlansService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AuditService,
          useValue: mockAudit,
        },
      ],
    }).compile();

    service = module.get<BillingPlansService>(BillingPlansService);
    jest.clearAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listActive', () => {
    it('should only fetch active plans ordered by sortOrder', async () => {
      mockPrismaService.billingPlan.findMany.mockResolvedValue([
        { slug: 'pro' },
      ]);

      await service.listActive();

      expect(mockPrismaService.billingPlan.findMany).toHaveBeenCalledWith({
        where: { status: 'active' },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('create', () => {
    it('should create a plan deriving slug from name', async () => {
      mockPrismaService.billingPlan.findUnique.mockResolvedValue(null);
      mockPrismaService.billingPlan.create.mockImplementation(({ data }) =>
        Promise.resolve({ slug: data.slug, ...data }),
      );

      const result = await service.create({
        name: 'Pro Plus',
        price: 9900,
        quotas: { MICROSERVICE: 10 },
      });

      expect(result.slug).toBe('pro-plus');
      expect(result.stripeProductId).toBe('prod_simulated_pro-plus');
      expect(result.stripePriceId).toBe('price_simulated_pro-plus');
      expect(mockPrismaService.billingPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'pro-plus',
            price: 9900,
            currency: 'usd',
            cycle: 'monthly',
            status: 'active',
          }),
        }),
      );
    });

    it('records an audit entry with the actor', async () => {
      mockPrismaService.billingPlan.findUnique.mockResolvedValue(null);
      mockPrismaService.billingPlan.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'plan-1', slug: data.slug, ...data }),
      );

      await service.create(
        { name: 'Pro', price: 9900 },
        {
          actorId: 'admin-1',
          actorEmail: 'admin@organator.app',
          ip: '127.0.0.1',
        },
      );

      expect(mockAudit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        actorEmail: 'admin@organator.app',
        ip: '127.0.0.1',
        action: 'billing_plan.created',
        resourceType: 'BillingPlan',
        resourceId: 'pro',
        changes: expect.objectContaining({
          slug: 'pro',
          name: 'Pro',
          price: 9900,
        }),
      });
    });

    it('should throw ConflictException when slug already exists', async () => {
      mockPrismaService.billingPlan.findUnique.mockResolvedValue({
        slug: 'pro',
      });

      await expect(
        service.create({ slug: 'pro', name: 'Pro' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should sync real Stripe refs when a real secret key is configured', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_realkey';
      mockPrismaService.billingPlan.findUnique.mockResolvedValue(null);
      mockPrismaService.billingPlan.create.mockImplementation(({ data }) =>
        Promise.resolve({ slug: data.slug, ...data }),
      );

      const result = await service.create({
        slug: 'team',
        name: 'Team',
        price: 2900,
      });

      expect(result.stripeProductId).toBe('prod_real');
      expect(result.stripePriceId).toBe('price_real');
    });
  });

  describe('update', () => {
    it('should throw NotFoundException when plan does not exist', async () => {
      mockPrismaService.billingPlan.findUnique.mockResolvedValue(null);

      await expect(service.update('pro', { name: 'Pro Max' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update plan fields and keep simulated stripe refs when price changes', async () => {
      mockPrismaService.billingPlan.findUnique.mockResolvedValue({
        slug: 'pro',
        name: 'Pro',
        price: 4900,
        currency: 'usd',
        cycle: 'monthly',
        stripeProductId: 'prod_simulated_pro',
      });
      mockPrismaService.billingPlan.update.mockImplementation(({ data }) =>
        Promise.resolve({ slug: 'pro', ...data }),
      );

      const result = await service.update('pro', { price: 5900 });

      expect(result.stripePriceId).toBe('price_simulated_pro');
      expect(mockPrismaService.billingPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: 'pro' } }),
      );
    });

    it('should not touch stripe when price and name are unchanged', async () => {
      mockPrismaService.billingPlan.findUnique.mockResolvedValue({
        slug: 'pro',
        name: 'Pro',
        price: 4900,
        currency: 'usd',
        cycle: 'monthly',
      });
      mockPrismaService.billingPlan.update.mockImplementation(({ data }) =>
        Promise.resolve({ slug: 'pro', ...data }),
      );

      await service.update('pro', { description: 'New desc' });

      const updateCall =
        mockPrismaService.billingPlan.update.mock.calls[0][0].data;
      expect(updateCall.stripeProductId).toBeUndefined();
      expect(updateCall.stripePriceId).toBeUndefined();
    });
  });

  describe('deactivate / remove', () => {
    it('should toggle status between active and inactive', async () => {
      mockPrismaService.billingPlan.findUnique.mockResolvedValue({
        slug: 'pro',
        status: 'active',
      });
      mockPrismaService.billingPlan.update.mockResolvedValue({
        slug: 'pro',
        status: 'inactive',
      });

      await service.deactivate('pro');

      expect(mockPrismaService.billingPlan.update).toHaveBeenCalledWith({
        where: { slug: 'pro' },
        data: { status: 'inactive' },
      });
    });

    it('should throw NotFoundException when deleting a missing plan', async () => {
      mockPrismaService.billingPlan.findUnique.mockResolvedValue(null);

      await expect(service.remove('ghost')).rejects.toThrow(NotFoundException);
    });

    it('should delete the plan and return confirmation', async () => {
      mockPrismaService.billingPlan.findUnique.mockResolvedValue({
        slug: 'pro',
      });
      mockPrismaService.billingPlan.delete.mockResolvedValue({ slug: 'pro' });

      const result = await service.remove('pro');

      expect(mockPrismaService.billingPlan.delete).toHaveBeenCalledWith({
        where: { slug: 'pro' },
      });
      expect(result).toEqual({ deleted: true, slug: 'pro' });
    });
  });
});

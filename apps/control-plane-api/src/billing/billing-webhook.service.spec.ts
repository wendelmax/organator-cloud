import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { BillingWebhookService } from './billing-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantLifecycleService } from '../tenants/tenant-lifecycle.service';
import { IamService } from '../iam/iam.service';
import { AuditService } from '../audit/audit.service';

describe('BillingWebhookService', () => {
  let service: BillingWebhookService;

  const mockPrisma = {
    webhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    tenant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    billingPlan: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockTenants = { createTenant: jest.fn(), changePlan: jest.fn() };
  const mockLifecycle = {
    restoreActive: jest.fn(),
    enterPastDue: jest.fn(),
    markSuspended: jest.fn(),
  };
  const mockIam = { linkOwnerAfterCheckout: jest.fn() };
  const mockAudit = { record: jest.fn() };
  const mockQueue = { add: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingWebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TenantsService, useValue: mockTenants },
        { provide: TenantLifecycleService, useValue: mockLifecycle },
        { provide: IamService, useValue: mockIam },
        { provide: AuditService, useValue: mockAudit },
        { provide: getQueueToken('provisioner'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<BillingWebhookService>(BillingWebhookService);
  });

  it('should dedupe duplicate events by event id', async () => {
    mockPrisma.webhookEvent.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const result = await service.process({
      id: 'evt-1',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1' } },
    });

    expect(result).toEqual({ received: true, duplicate: true });
    expect(mockLifecycle.enterPastDue).not.toHaveBeenCalled();
  });

  describe('checkout.session.completed', () => {
    it('should create tenant in onboarding then activate and provision', async () => {
      mockTenants.createTenant.mockResolvedValue({
        id: 'tenant-1',
        slug: 'acme',
        plan: 'pro',
      });
      mockLifecycle.restoreActive.mockResolvedValue({ id: 'tenant-1' });

      const result = await service.process({
        id: 'evt-checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { tenantName: 'Acme', plan: 'pro' },
            customer_email: 'owner@acme.com',
            customer: 'cus_real',
          },
        },
      });

      expect(result).toEqual({ received: true, tenantId: 'tenant-1' });
      expect(mockTenants.createTenant).toHaveBeenCalledWith(
        'Acme',
        'pro',
        'owner@acme.com',
        expect.objectContaining({ state: 'onboarding', stripeId: 'cus_real' }),
      );
      expect(mockLifecycle.restoreActive).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ reason: 'checkout.session.completed' }),
      );
      expect(mockIam.linkOwnerAfterCheckout).toHaveBeenCalledWith(
        'tenant-1',
        'acme',
        'owner@acme.com',
      );
      expect(mockQueue.add).toHaveBeenCalledWith('deploy-tenant-infra', {
        tenantId: 'tenant-1',
        plan: 'pro',
        action: 'INITIAL_PROVISIONING',
      });
      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventId: 'evt-checkout',
          type: 'checkout.session.completed',
        }),
      });
      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
        where: { eventId: 'evt-checkout' },
        data: expect.objectContaining({ tenantId: 'tenant-1' }),
      });
    });

    describe('upgrade of an existing tenant (metadata.tenantId)', () => {
      const upgrade = (plan = 'pro', customer: unknown = 'cus_new') => ({
        id: 'evt-upgrade',
        type: 'checkout.session.completed',
        data: {
          object: { metadata: { tenantId: 'tenant-1', plan }, customer },
        },
      });

      it('links the Stripe customer and changes the plan without creating a tenant', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue({
          id: 'tenant-1',
          plan: 'free',
          stripeId: null,
        });

        const result = await service.process(upgrade());

        expect(result).toEqual({
          received: true,
          tenantId: 'tenant-1',
          upgraded: true,
        });
        expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
          where: { id: 'tenant-1' },
          data: { stripeId: 'cus_new' },
        });
        expect(mockTenants.changePlan).toHaveBeenCalledWith('tenant-1', 'pro');
        expect(mockTenants.createTenant).not.toHaveBeenCalled();
        expect(mockQueue.add).not.toHaveBeenCalled();
      });

      it('leaves an already linked customer and the same plan untouched', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue({
          id: 'tenant-1',
          plan: 'Pro',
          stripeId: 'cus_new',
        });

        await service.process(upgrade('pro'));

        expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
        expect(mockTenants.changePlan).not.toHaveBeenCalled();
      });

      it('reports an unknown tenant', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(null);

        const result = await service.process(upgrade());

        expect(result).toEqual({ received: true, error: 'Unknown tenant' });
        expect(mockTenants.changePlan).not.toHaveBeenCalled();
      });
    });

    it('records the coupon use of a completed signup checkout', async () => {
      const coupons = { redeem: jest.fn() };
      const withCoupons = new BillingWebhookService(
        mockPrisma as any,
        mockTenants as any,
        mockLifecycle as any,
        mockIam as any,
        mockAudit as any,
        mockQueue as any,
        coupons as any,
      );
      mockTenants.createTenant.mockResolvedValue({
        id: 'tenant-1',
        slug: 'acme',
        plan: 'pro',
      });

      await withCoupons.process({
        id: 'evt-coupon',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_9',
            metadata: {
              tenantName: 'Acme',
              plan: 'pro',
              couponCode: 'LANCAMENTO20',
            },
            customer_email: 'owner@acme.com',
            customer: 'cus_1',
          },
        },
      });

      expect(coupons.redeem).toHaveBeenCalledWith('LANCAMENTO20', {
        tenantId: 'tenant-1',
        checkoutSessionId: 'cs_9',
      });
    });

    it('should ignore checkout without tenantName', async () => {
      const result = await service.process({
        id: 'evt-checkout',
        type: 'checkout.session.completed',
        data: { object: { metadata: {} } },
      });

      expect(result).toEqual({
        received: true,
        error: 'No tenantName in metadata',
      });
      expect(mockTenants.createTenant).not.toHaveBeenCalled();
    });
  });

  describe('invoice.payment_failed', () => {
    it('should transition to past_due', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });

      const result = await service.process({
        id: 'evt-invoice',
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_1' } },
      });

      expect(result).toEqual({ received: true, tenantId: 'tenant-1' });
      expect(mockLifecycle.enterPastDue).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ reason: 'invoice.payment_failed' }),
      );
    });

    it('should ignore unknown customer', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      const result = await service.process({
        id: 'evt-invoice',
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_unknown' } },
      });

      expect(result).toEqual({ received: true, error: 'Unknown customer' });
      expect(mockLifecycle.enterPastDue).not.toHaveBeenCalled();
    });
  });

  describe('customer.subscription.deleted', () => {
    it('should suspend the tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });

      const result = await service.process({
        id: 'evt-sub-del',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_1' } },
      });

      expect(mockLifecycle.markSuspended).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ reason: 'customer.subscription.deleted' }),
      );
      expect(result).toEqual({ received: true, tenantId: 'tenant-1' });
    });
  });

  describe('customer.subscription.updated', () => {
    it('should restore active and sync plan from price', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findFirst.mockResolvedValue({ slug: 'pro' });
      mockTenants.changePlan.mockResolvedValue({ id: 'tenant-1', plan: 'pro' });

      const result = await service.process({
        id: 'evt-sub-upd',
        type: 'customer.subscription.updated',
        data: {
          object: {
            customer: 'cus_1',
            status: 'active',
            items: { data: [{ price: { id: 'price_1' } }] },
          },
        },
      });

      expect(mockTenants.changePlan).toHaveBeenCalledWith('tenant-1', 'pro');
      expect(mockLifecycle.restoreActive).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          reason: 'customer.subscription.updated:active',
        }),
      );
      expect(result).toEqual({ received: true, tenantId: 'tenant-1' });
    });

    it('should suspend on unpaid status', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findFirst.mockResolvedValue(null);

      await service.process({
        id: 'evt-sub-unpaid',
        type: 'customer.subscription.updated',
        data: {
          object: { customer: 'cus_1', status: 'unpaid', items: { data: [] } },
        },
      });

      expect(mockLifecycle.markSuspended).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          reason: 'customer.subscription.updated:unpaid',
        }),
      );
    });
  });

  it('processes concurrent deliveries of the same event only once', async () => {
    const claimed = new Set<string>();
    mockPrisma.webhookEvent.create.mockImplementation(async ({ data }) => {
      if (claimed.has(data.eventId)) {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        });
      }
      claimed.add(data.eventId);
      return {};
    });
    mockPrisma.billingPlan.findUnique.mockResolvedValue(null);
    mockTenants.createTenant.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
      plan: 'pro',
    });
    const event = {
      id: 'evt-race',
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { tenantName: 'Acme', plan: 'pro' },
          customer_email: 'owner@acme.com',
        },
      },
    };

    const results = await Promise.all([
      service.process(event),
      service.process(event),
    ]);

    expect(mockTenants.createTenant).toHaveBeenCalledTimes(1);
    expect(results).toContainEqual({ received: true, duplicate: true });
  });

  it('releases the event when processing fails so the Stripe retry can succeed', async () => {
    mockPrisma.tenant.findUnique.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.process({
        id: 'evt-fail',
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_1' } },
      }),
    ).rejects.toThrow('db down');
    expect(mockPrisma.webhookEvent.delete).toHaveBeenCalledWith({
      where: { eventId: 'evt-fail' },
    });
  });

  it('should record and ignore unknown event types', async () => {
    const result = await service.process({
      id: 'evt-other',
      type: 'charge.refunded',
      data: { object: {} },
    });

    expect(result).toEqual({ received: true, ignored: true });
    expect(mockPrisma.webhookEvent.create).toHaveBeenCalled();
  });
});

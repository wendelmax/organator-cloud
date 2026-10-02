const portalCreate = jest.fn();
const checkoutCreate = jest.fn();
const invoicesList = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    billingPortal: { sessions: { create: portalCreate } },
    invoices: { list: invoicesList },
    checkout: { sessions: { create: checkoutCreate } },
  })),
);

import { BadGatewayException, ConflictException } from '@nestjs/common';
import { BillingService } from './billing.service';

describe('BillingService — Stripe sessions', () => {
  const originalEnv = { ...process.env };
  let prisma: any;
  let audit: any;
  let service: BillingService;

  beforeEach(() => {
    portalCreate
      .mockReset()
      .mockResolvedValue({ url: 'https://billing.stripe.com/p/real' });
    checkoutCreate
      .mockReset()
      .mockResolvedValue({ url: 'https://checkout.stripe.com/c/real' });
    process.env.BACKOFFICE_URL = 'https://app.acme.com';
    prisma = {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 't1', plan: 'Free', stripeId: 'cus_1' }),
      },
      billingPlan: {
        findUnique: jest.fn().mockResolvedValue({
          slug: 'pro',
          status: 'active',
          stripePriceId: 'price_pro',
        }),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new BillingService(prisma, { resolve: jest.fn() } as any, audit);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('createPortalSession', () => {
    it('refuses tenants without a Stripe customer instead of faking a portal URL', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', stripeId: null });
      await expect(
        service.createPortalSession('t1', 'https://app.acme.com/billing'),
      ).rejects.toThrow(ConflictException);
      expect(portalCreate).not.toHaveBeenCalled();
    });

    it('opens the Stripe portal for the tenant customer', async () => {
      await expect(
        service.createPortalSession('t1', 'https://app.acme.com/settings'),
      ).resolves.toEqual({
        url: 'https://billing.stripe.com/p/real',
      });
      expect(portalCreate).toHaveBeenCalledWith({
        customer: 'cus_1',
        return_url: 'https://app.acme.com/settings',
      });
    });

    it('does not allow redirecting back to a foreign origin (open redirect)', async () => {
      await service.createPortalSession('t1', 'https://evil.example/phish');
      expect(portalCreate.mock.calls[0][0].return_url).toBe(
        'https://app.acme.com/billing',
      );
    });

    it('reports 502 when Stripe fails', async () => {
      portalCreate.mockRejectedValue(new Error('No such customer'));
      await expect(service.createPortalSession('t1', '')).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('createUpgradeSession', () => {
    it('creates a subscription checkout with tenant metadata and audits the request', async () => {
      const result = await service.createUpgradeSession(
        't1',
        'PRO',
        'https://app.acme.com/billing',
        'u1',
      );

      expect(prisma.billingPlan.findUnique).toHaveBeenCalledWith({
        where: { slug: 'pro' },
      });
      expect(checkoutCreate).toHaveBeenCalledWith({
        mode: 'subscription',
        customer: 'cus_1',
        line_items: [{ price: 'price_pro', quantity: 1 }],
        success_url: 'https://app.acme.com/billing?upgrade=success',
        cancel_url: 'https://app.acme.com/billing?upgrade=canceled',
        metadata: { tenantId: 't1', plan: 'pro' },
      });
      expect(result).toEqual({ url: 'https://checkout.stripe.com/c/real' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.upgrade_requested',
          actorId: 'u1',
          changes: { from: 'Free', to: 'pro' },
        }),
      );
    });

    it('simulates checkout when the plan has no Stripe price', async () => {
      prisma.billingPlan.findUnique.mockResolvedValue({
        slug: 'team plus',
        status: 'active',
      });
      const { url } = await service.createUpgradeSession('t1', 'team plus');
      expect(url).toBe(
        'https://app.acme.com/billing?checkout=simulated&plan=team%20plus',
      );
      expect(checkoutCreate).not.toHaveBeenCalled();
    });

    it.each(['https://evil.example/x', 'javascript:alert(1)', 'not a url'])(
      'replaces unsafe return URL %s with the backoffice',
      async (returnUrl) => {
        await service.createUpgradeSession('t1', 'pro', returnUrl);
        expect(checkoutCreate.mock.calls[0][0].success_url).toBe(
          'https://app.acme.com/billing?upgrade=success',
        );
      },
    );

    it('rejects inactive plans', async () => {
      prisma.billingPlan.findUnique.mockResolvedValue({
        slug: 'legacy',
        status: 'archived',
      });
      await expect(
        service.createUpgradeSession('t1', 'legacy'),
      ).rejects.toThrow('not found');
    });

    it('omits the customer for tenants never billed', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't1',
        plan: 'Free',
        stripeId: null,
      });
      await service.createUpgradeSession('t1', 'pro');
      expect(checkoutCreate.mock.calls[0][0].customer).toBeUndefined();
    });
  });

  describe('getSubscription invoices', () => {
    beforeEach(() => {
      prisma.billingPlan.findUnique.mockResolvedValue(null);
      Object.assign(prisma, {
        microservice: { count: jest.fn().mockResolvedValue(0) },
        deployment: { count: jest.fn().mockResolvedValue(0) },
        user: { count: jest.fn().mockResolvedValue(0) },
        apiDoc: { count: jest.fn().mockResolvedValue(0) },
      });
      invoicesList.mockReset().mockResolvedValue({
        data: [
          {
            id: 'in_1',
            number: 'ACME-0001',
            status: 'paid',
            amount_paid: 4900,
            amount_due: 4900,
            currency: 'brl',
            created: 1767225600,
            hosted_invoice_url: 'https://invoice.stripe.com/i/1',
          },
          {
            id: 'in_2',
            number: null,
            status: 'open',
            amount_paid: 0,
            amount_due: 9900,
            currency: 'brl',
            created: 1769904000,
            hosted_invoice_url: null,
          },
        ],
      });
    });

    it('lists the real Stripe invoices of the tenant customer', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_live_real';
      const { invoices } = await service.getSubscription('t1');

      expect(invoicesList).toHaveBeenCalledWith({
        customer: 'cus_1',
        limit: 12,
      });
      expect(invoices).toEqual([
        {
          id: 'ACME-0001',
          amount: 4900,
          currency: 'brl',
          status: 'paid',
          date: '2026-01-01T00:00:00.000Z',
          url: 'https://invoice.stripe.com/i/1',
        },
        {
          id: 'in_2',
          amount: 9900,
          currency: 'brl',
          status: 'open',
          date: '2026-02-01T00:00:00.000Z',
          url: null,
        },
      ]);
    });

    it('returns no invoices without a customer or a real Stripe key', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      expect((await service.getSubscription('t1')).invoices).toEqual([]);

      process.env.STRIPE_SECRET_KEY = 'sk_live_real';
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't1',
        plan: 'Free',
        stripeId: null,
      });
      expect((await service.getSubscription('t1')).invoices).toEqual([]);
      expect(invoicesList).not.toHaveBeenCalled();
    });

    it('degrades to no invoices when Stripe fails', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_live_real';
      invoicesList.mockRejectedValue(new Error('rate limited'));
      expect((await service.getSubscription('t1')).invoices).toEqual([]);
    });
  });

  it('getSubscription works without tenant (defaults, zero usage)', async () => {
    const result = await service.getSubscription('');
    expect(result).toMatchObject({
      plan: 'Pro',
      price: 0,
      status: 'active',
      usage: { MICROSERVICE: 0, DEPLOYMENT: 0, SEATS: 0, APIS: 0 },
    });
  });
});

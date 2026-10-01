const portalCreate = jest.fn();
const checkoutCreate = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    billingPortal: { sessions: { create: portalCreate } },
    checkout: { sessions: { create: checkoutCreate } },
  })),
);

import { BillingService } from './billing.service';

describe('BillingService — Stripe sessions', () => {
  const originalEnv = { ...process.env };
  let prisma: any;
  let audit: any;
  let service: BillingService;

  beforeEach(() => {
    portalCreate.mockReset().mockResolvedValue({ url: 'https://billing.stripe.com/p/real' });
    checkoutCreate.mockReset().mockResolvedValue({ url: 'https://checkout.stripe.com/c/real' });
    process.env.BACKOFFICE_URL = 'https://app.acme.com';
    prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1', plan: 'Free', stripeId: 'cus_1' }) },
      billingPlan: { findUnique: jest.fn().mockResolvedValue({ slug: 'pro', status: 'active', stripePriceId: 'price_pro' }) },
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
    it('returns a simulated URL for tenants without a Stripe customer', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', stripeId: null });
      const { url } = await service.createPortalSession('t1', 'https://app.acme.com/billing');
      expect(url).toMatch(/^https:\/\/billing\.stripe\.com\/p\/session\/test_/);
      expect(portalCreate).not.toHaveBeenCalled();
    });

    it('opens the Stripe portal for the tenant customer', async () => {
      await expect(service.createPortalSession('t1', 'https://app.acme.com/settings')).resolves.toEqual({
        url: 'https://billing.stripe.com/p/real',
      });
      expect(portalCreate).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'https://app.acme.com/settings' });
    });

    it('does not allow redirecting back to a foreign origin (open redirect)', async () => {
      await service.createPortalSession('t1', 'https://evil.example/phish');
      expect(portalCreate.mock.calls[0][0].return_url).toBe('https://app.acme.com/billing');
    });

    it('falls back when Stripe fails', async () => {
      portalCreate.mockRejectedValue(new Error('No such customer'));
      const { url } = await service.createPortalSession('t1', '');
      expect(url).toMatch(/test_/);
    });
  });

  describe('createUpgradeSession', () => {
    it('creates a subscription checkout with tenant metadata and audits the request', async () => {
      const result = await service.createUpgradeSession('t1', 'PRO', 'https://app.acme.com/billing', 'u1');

      expect(prisma.billingPlan.findUnique).toHaveBeenCalledWith({ where: { slug: 'pro' } });
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
        expect.objectContaining({ action: 'billing.upgrade_requested', actorId: 'u1', changes: { from: 'Free', to: 'pro' } }),
      );
    });

    it('simulates checkout when the plan has no Stripe price', async () => {
      prisma.billingPlan.findUnique.mockResolvedValue({ slug: 'team plus', status: 'active' });
      const { url } = await service.createUpgradeSession('t1', 'team plus');
      expect(url).toBe('https://app.acme.com/billing?checkout=simulated&plan=team%20plus');
      expect(checkoutCreate).not.toHaveBeenCalled();
    });

    it.each(['https://evil.example/x', 'javascript:alert(1)', 'not a url'])(
      'replaces unsafe return URL %s with the backoffice',
      async (returnUrl) => {
        await service.createUpgradeSession('t1', 'pro', returnUrl);
        expect(checkoutCreate.mock.calls[0][0].success_url).toBe('https://app.acme.com/billing?upgrade=success');
      },
    );

    it('rejects inactive plans', async () => {
      prisma.billingPlan.findUnique.mockResolvedValue({ slug: 'legacy', status: 'archived' });
      await expect(service.createUpgradeSession('t1', 'legacy')).rejects.toThrow('not found');
    });

    it('omits the customer for tenants never billed', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', plan: 'Free', stripeId: null });
      await service.createUpgradeSession('t1', 'pro');
      expect(checkoutCreate.mock.calls[0][0].customer).toBeUndefined();
    });
  });

  it('getSubscription works without tenant (defaults, zero usage)', async () => {
    const result = await service.getSubscription('');
    expect(result).toMatchObject({ plan: 'Pro', price: 0, status: 'active', usage: { MICROSERVICE: 0, DEPLOYMENT: 0, SEATS: 0, APIS: 0 } });
  });
});

const constructEvent = jest.fn();
const createSession = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent },
    checkout: { sessions: { create: createSession } },
  })),
);

import { BadRequestException } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';

describe('OnboardingController', () => {
  const originalEnv = { ...process.env };
  let webhook: any;
  let plans: any;
  let controller: OnboardingController;

  beforeEach(() => {
    constructEvent.mockReset();
    createSession
      .mockReset()
      .mockResolvedValue({ url: 'https://checkout.stripe/s1' });
    webhook = { process: jest.fn().mockResolvedValue({ received: true }) };
    plans = { getBySlug: jest.fn().mockResolvedValue(null) };
    controller = new OnboardingController(webhook, plans);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('webhook', () => {
    it('verifies the Stripe signature against the raw body', async () => {
      process.env.NODE_ENV = 'development';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_real';
      const event = { type: 'checkout.session.completed' };
      constructEvent.mockReturnValue(event);
      const raw = Buffer.from('{}');

      await expect(
        controller.handleStripeWebhook('sig', { rawBody: raw }),
      ).resolves.toEqual({ received: true });
      expect(constructEvent).toHaveBeenCalledWith(raw, 'sig', 'whsec_real');
      expect(webhook.process).toHaveBeenCalledWith(event);
    });

    it('rejects invalid signatures with 400 and never processes the event', async () => {
      process.env.NODE_ENV = 'development';
      constructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });

      await expect(
        controller.handleStripeWebhook('bad', { rawBody: Buffer.from('') }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(webhook.process).not.toHaveBeenCalled();
    });

    it('refuses to run in production without STRIPE_WEBHOOK_SECRET', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await expect(
        controller.handleStripeWebhook('sig', { rawBody: Buffer.from('') }),
      ).rejects.toThrow(/STRIPE_WEBHOOK_SECRET/);
      expect(constructEvent).not.toHaveBeenCalled();
    });

    it('accepts unsigned bodies only under NODE_ENV=test', async () => {
      process.env.NODE_ENV = 'test';
      const body = { type: 'invoice.paid' };
      await controller.handleStripeWebhook(undefined as any, { body });
      expect(webhook.process).toHaveBeenCalledWith(body);
      expect(constructEvent).not.toHaveBeenCalled();
    });

    it('still verifies signed requests under NODE_ENV=test', async () => {
      process.env.NODE_ENV = 'test';
      constructEvent.mockReturnValue({ type: 'x' });
      await controller.handleStripeWebhook('sig', {
        rawBody: Buffer.from(''),
        body: { forged: true },
      });
      expect(webhook.process).toHaveBeenCalledWith({ type: 'x' });
    });
  });

  describe('checkout', () => {
    const signup = { tenantName: 'Acme', email: 'o@acme.com' };

    it('opens a subscription checkout with the configured Stripe price', async () => {
      process.env.BACKOFFICE_URL = 'https://app.example.com/';
      plans.getBySlug.mockResolvedValue({
        price: 9900,
        stripePriceId: 'price_pro',
      });
      const result = await controller.createCheckoutSession({
        ...signup,
        plan: 'PRO',
      });

      expect(plans.getBySlug).toHaveBeenCalledWith('pro');
      expect(createSession).toHaveBeenCalledWith({
        mode: 'subscription',
        line_items: [{ price: 'price_pro', quantity: 1 }],
        success_url: 'https://app.example.com/login?success=true',
        cancel_url: 'https://app.example.com/register?canceled=true',
        metadata: { tenantName: 'Acme', plan: 'pro' },
        subscription_data: { metadata: { tenantName: 'Acme', plan: 'pro' } },
        customer_email: 'o@acme.com',
      });
      expect(result).toEqual({ url: 'https://checkout.stripe/s1' });
    });

    it('builds a recurring inline price when the plan has no real Stripe price', async () => {
      plans.getBySlug.mockResolvedValue({
        price: 2500,
        currency: 'brl',
        cycle: 'yearly',
        stripePriceId: 'price_simulated_starter',
      });
      await controller.createCheckoutSession({ ...signup, plan: 'starter' });
      const item = createSession.mock.calls[0][0].line_items[0];
      expect(item.price).toBeUndefined();
      expect(item.price_data).toMatchObject({
        currency: 'brl',
        unit_amount: 2500,
        recurring: { interval: 'year' },
      });
    });

    it.each([
      ['enterprise', 19900],
      ['pro', 4900],
    ])(
      'falls back to default monthly pricing for unknown plan %s',
      async (plan, amount) => {
        await controller.createCheckoutSession({ ...signup, plan });
        const { price_data } = createSession.mock.calls[0][0].line_items[0];
        expect(price_data.unit_amount).toBe(amount);
        expect(price_data.recurring).toEqual({ interval: 'month' });
      },
    );

    it('defaults to the free plan', async () => {
      await controller.createCheckoutSession(signup);
      expect(plans.getBySlug).toHaveBeenCalledWith('free');
    });

    it.each([
      [{}],
      [{ tenantName: '  ', email: 'o@acme.com' }],
      [{ tenantName: 'Acme', email: 'not-an-email' }],
      [{ tenantName: 'Acme' }],
    ])(
      'rejects incomplete signups without calling Stripe (%j)',
      async (body) => {
        await expect(controller.createCheckoutSession(body)).rejects.toThrow(
          BadRequestException,
        );
        expect(createSession).not.toHaveBeenCalled();
      },
    );
  });
});

describe('OnboardingController — free signup', () => {
  let plans: any;
  let prisma: any;
  let tenants: any;
  let audit: any;
  let controller: OnboardingController;
  const body = { tenantName: 'Acme', email: 'owner@acme.com', plan: 'free' };
  const accepted = {
    accepted: true,
    message:
      'Se o e-mail puder ser usado, enviamos um link para ativar a conta e definir a senha.',
  };

  beforeEach(() => {
    plans = {
      getBySlug: jest
        .fn()
        .mockResolvedValue({ slug: 'free', status: 'active', price: 0 }),
    };
    prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    tenants = { createTenant: jest.fn().mockResolvedValue({ id: 't-new' }) };
    audit = { record: jest.fn() };
    controller = new OnboardingController(
      {} as any,
      plans,
      prisma,
      tenants,
      audit,
    );
  });

  it('creates the tenant on a free plan; the owner gets the activation e-mail', async () => {
    await expect(controller.signup({ ip: '1.2.3.4' }, body)).resolves.toEqual(
      accepted,
    );
    expect(tenants.createTenant).toHaveBeenCalledWith(
      'Acme',
      'free',
      'owner@acme.com',
      { actorEmail: 'owner@acme.com' },
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'onboarding.free_signup',
        resourceId: 't-new',
      }),
    );
  });

  it('answers the same for an e-mail that already has an account, creating nothing', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u-1' });
    await expect(controller.signup({}, body)).resolves.toEqual(accepted);
    expect(tenants.createTenant).not.toHaveBeenCalled();
  });

  it('sends paid, inactive or unknown plans to the checkout', async () => {
    for (const plan of [
      { slug: 'pro', status: 'active', price: 4900 },
      { slug: 'free', status: 'inactive', price: 0 },
      null,
    ]) {
      plans.getBySlug.mockResolvedValueOnce(plan);
      await expect(controller.signup({}, body)).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(tenants.createTenant).not.toHaveBeenCalled();
  });

  it.each([
    [{ email: 'owner@acme.com' }],
    [{ tenantName: 'Acme', email: 'nope' }],
  ])('rejects incomplete signups (%j)', async (incomplete) => {
    await expect(controller.signup({}, incomplete)).rejects.toThrow(
      BadRequestException,
    );
  });
});

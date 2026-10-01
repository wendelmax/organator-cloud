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
    it('uses the configured Stripe price of the plan', async () => {
      plans.getBySlug.mockResolvedValue({
        price: 9900,
        stripePriceId: 'price_pro',
      });
      const result = await controller.createCheckoutSession({
        plan: 'PRO',
        tenantName: 'Acme',
        email: 'o@acme.com',
      });

      expect(plans.getBySlug).toHaveBeenCalledWith('pro');
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: 'price_pro', quantity: 1 }],
          mode: 'payment',
          metadata: { tenantName: 'Acme', plan: 'pro' },
          customer_email: 'o@acme.com',
        }),
      );
      expect(result).toEqual({ url: 'https://checkout.stripe/s1' });
    });

    it('builds inline price data from the plan price when no Stripe price is set', async () => {
      plans.getBySlug.mockResolvedValue({ price: 2500 });
      await controller.createCheckoutSession({ plan: 'starter' });
      const item = createSession.mock.calls[0][0].line_items[0];
      expect(item.price_data).toMatchObject({
        currency: 'usd',
        unit_amount: 2500,
      });
    });

    it.each([
      ['enterprise', 19900],
      ['pro', 4900],
    ])(
      'falls back to default pricing for unknown plan %s',
      async (plan, amount) => {
        await controller.createCheckoutSession({ plan });
        expect(
          createSession.mock.calls[0][0].line_items[0].price_data.unit_amount,
        ).toBe(amount);
      },
    );

    it('defaults to the free plan', async () => {
      await controller.createCheckoutSession({});
      expect(plans.getBySlug).toHaveBeenCalledWith('free');
    });
  });
});

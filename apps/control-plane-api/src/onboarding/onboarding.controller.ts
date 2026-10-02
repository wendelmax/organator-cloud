import {
  Controller,
  Post,
  Body,
  Req,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { BillingPlansService } from '../billing/billing-plans.service';
import { BillingWebhookService } from '../billing/billing-webhook.service';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});

@Controller('v1/onboarding')
export class OnboardingController {
  constructor(
    private readonly billingWebhook: BillingWebhookService,
    private readonly plansService: BillingPlansService,
  ) {}

  @Post('webhook')
  async handleStripeWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: any,
  ) {
    let event: any;

    try {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret && process.env.NODE_ENV === 'production') {
        throw new Error(
          'STRIPE_WEBHOOK_SECRET environment variable is missing in production!',
        );
      }
      const webhookSecret = secret || 'whsec_test';
      if (process.env.NODE_ENV === 'test' && !signature) {
        event = req.body;
      } else {
        event = stripe.webhooks.constructEvent(
          req.rawBody as Buffer,
          signature,
          webhookSecret,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Webhook Error: ${message}`);
    }

    return this.billingWebhook.process(event);
  }

  @Post('checkout')
  async createCheckoutSession(@Body() body: any) {
    const tenantName =
      typeof body?.tenantName === 'string' ? body.tenantName.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (!tenantName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException(
        'tenantName and a valid email are required',
      );
    }

    const planSlug = String(body.plan || 'free').toLowerCase();
    const plan = await this.plansService.getBySlug(planSlug);
    const unitAmount =
      plan?.price ?? (planSlug === 'enterprise' ? 19900 : 4900);
    // Preços "simulados" (Stripe desabilitado na sincronização do plano) não
    // existem na conta Stripe: monta o preço inline.
    const price =
      plan?.stripePriceId && !plan.stripePriceId.startsWith('price_simulated_')
        ? plan.stripePriceId
        : undefined;

    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = price
      ? { price, quantity: 1 }
      : {
          price_data: {
            currency: plan?.currency || 'usd',
            product_data: { name: `Plan ${planSlug}` },
            unit_amount: unitAmount,
            recurring: {
              interval: plan?.cycle === 'yearly' ? 'year' : 'month',
            },
          },
          quantity: 1,
        };

    const metadata = { tenantName, plan: planSlug };
    const backoffice = (
      process.env.BACKOFFICE_URL || 'http://localhost:3000'
    ).replace(/\/+$/, '');
    // Assinatura (não pagamento avulso): os preços dos planos são recorrentes e
    // o ciclo de vida do tenant depende dos eventos de invoice/subscription.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [lineItem],
      success_url: `${backoffice}/login?success=true`,
      cancel_url: `${backoffice}/register?canceled=true`,
      metadata,
      subscription_data: { metadata },
      customer_email: email,
    });
    return { url: session.url };
  }
}

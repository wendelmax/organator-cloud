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
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    return this.billingWebhook.process(event);
  }

  @Post('checkout')
  async createCheckoutSession(@Body() body: any) {
    const planSlug = (body.plan || 'free').toLowerCase();
    const plan = await this.plansService.getBySlug(planSlug);
    const unitAmount =
      plan?.price ?? (planSlug === 'enterprise' ? 19900 : 4900);
    const price = plan?.stripePriceId;

    const lineItem = price
      ? { price, quantity: 1 }
      : {
          price_data: {
            currency: 'usd',
            product_data: { name: `Plan ${body.plan}` },
            unit_amount: unitAmount,
          },
          quantity: 1,
        };

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [lineItem],
      mode: 'payment',
      success_url: 'http://localhost:3000/login?success=true',
      cancel_url: 'http://localhost:3000/register?canceled=true',
      metadata: {
        tenantName: body.tenantName,
        plan: planSlug,
      },
      customer_email: body.email,
    });
    return { url: session.url };
  }
}

import {
  Controller,
  Post,
  Body,
  Req,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TenantsService } from '../tenants/tenants.service';
import { IamService } from '../iam/iam.service';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});

@Controller('v1/onboarding')
export class OnboardingController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly iamService: IamService,
    @InjectQueue('provisioner') private readonly provisionerQueue: Queue,
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { metadata, customer_email } = session;

      if (!metadata?.tenantName) {
        return { received: true, error: 'No tenantName in metadata' };
      }

      console.log(`[Webhook] Pagamento recebido para ${metadata.tenantName}`);

      const tenant = await this.tenantsService.createTenant(
        metadata.tenantName,
        metadata.plan,
        customer_email || 'customer@example.com',
      );

      console.log(
        `[Provisioner] Disparando fila para criar banco isolado para o tenant ${tenant.id}...`,
      );

      // IAM: grupo por tenant + convite do OWNER no VoidAuth (ou self-registration via OIDC)
      await this.iamService.linkOwnerAfterCheckout(
        tenant.id,
        tenant.slug,
        customer_email || 'customer@example.com',
      );

      await this.provisionerQueue.add('deploy-tenant-infra', {
        tenantId: tenant.id,
        plan: tenant.plan,
        action: 'INITIAL_PROVISIONING',
      });

      return { received: true, tenantId: tenant.id };
    }

    return { received: true };
  }

  @Post('checkout')
  async createCheckoutSession(@Body() body: any) {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: `Plan ${body.plan}` },
            unit_amount: body.plan === 'Enterprise' ? 19900 : 4900,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'http://localhost:3000/login?success=true',
      cancel_url: 'http://localhost:3000/register?canceled=true',
      metadata: {
        tenantName: body.tenantName,
        plan: body.plan,
      },
      customer_email: body.email,
    });
    return { url: session.url };
  }
}

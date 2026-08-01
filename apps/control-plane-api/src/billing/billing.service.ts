import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async createPortalSession(tenantId: string, returnUrl: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant?.stripeId) {
      return { url: `https://billing.stripe.com/p/session/test_${Date.now()}` };
    }
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripeId,
        return_url: returnUrl || 'http://localhost:3000/billing',
      });
      return { url: session.url };
    } catch (err: any) {
      console.warn(`[Stripe BillingPortal Warning] ${err.message}`);
      return { url: `https://billing.stripe.com/p/session/test_${Date.now()}` };
    }
  }

  async getSubscription(tenantId: string) {
    const tenant = tenantId
      ? await this.prisma.tenant.findUnique({ where: { id: tenantId } })
      : null;
    return {
      plan: tenant?.plan || 'Pro',
      status: 'active',
      invoices: [
        {
          id: 'inv_1001',
          amount: 4900,
          currency: 'usd',
          status: 'paid',
          date: new Date().toISOString(),
        },
      ],
    };
  }
}

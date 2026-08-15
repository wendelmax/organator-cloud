import { Injectable, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

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
    const entitlements = tenantId
      ? await this.entitlements.resolve(tenantId)
      : null;
    const plan = tenant
      ? await this.prisma.billingPlan.findUnique({
          where: { slug: tenant.plan.toLowerCase() },
        })
      : null;
    const [microservices, deployments, users, apiDocs] = tenantId
      ? await Promise.all([
          this.prisma.microservice.count({ where: { tenantId } }),
          this.prisma.deployment.count({
            where: { OR: [{ tenantId }, { microservice: { tenantId } }] },
          }),
          this.prisma.user.count({ where: { tenantId } }),
          this.prisma.apiDoc.count({ where: { microservice: { tenantId } } }),
        ])
      : [0, 0, 0, 0];
    const usage = {
      MICROSERVICE: microservices,
      DEPLOYMENT: deployments,
      SEATS: users,
      APIS: apiDocs,
    };
    return {
      plan: tenant?.plan || 'Pro',
      price: plan?.price ?? 0,
      currency: plan?.currency ?? 'usd',
      cycle: plan?.cycle ?? 'monthly',
      renewalAt: null,
      status:
        tenant?.state === 'past_due'
          ? 'past_due'
          : tenant?.state === 'suspended'
            ? 'suspended'
            : 'active',
      entitlements,
      usage,
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

  async createUpgradeSession(
    tenantId: string,
    planSlug: string,
    returnUrl?: string,
    actorId?: string,
  ) {
    const [tenant, plan] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
      this.prisma.billingPlan.findUnique({
        where: { slug: planSlug.toLowerCase() },
      }),
    ]);
    if (!tenant || !plan || plan.status !== 'active') {
      throw new NotFoundException('Tenant or target plan not found');
    }
    const safeReturnUrl = this.safeReturnUrl(returnUrl);
    await this.audit.record({
      actorId: actorId ?? null,
      action: 'billing.upgrade_requested',
      resourceType: 'Tenant',
      resourceId: tenantId,
      changes: { from: tenant.plan, to: plan.slug },
    });
    if (!plan.stripePriceId) {
      return {
        url: `${safeReturnUrl}?checkout=simulated&plan=${encodeURIComponent(plan.slug)}`,
      };
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: tenant.stripeId || undefined,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${safeReturnUrl}?upgrade=success`,
      cancel_url: `${safeReturnUrl}?upgrade=canceled`,
      metadata: { tenantId, plan: plan.slug },
    });
    return { url: session.url };
  }

  private safeReturnUrl(returnUrl?: string): string {
    const fallback = `${process.env.BACKOFFICE_URL || 'http://localhost:3000'}/billing`;
    if (!returnUrl) return fallback;
    try {
      const candidate = new URL(returnUrl);
      const allowedOrigin = new URL(
        process.env.BACKOFFICE_URL || 'http://localhost:3000',
      ).origin;
      return candidate.origin === allowedOrigin
        ? candidate.toString()
        : fallback;
    } catch {
      return fallback;
    }
  }
}

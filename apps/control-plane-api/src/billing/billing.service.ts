import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});

const DEV_STRIPE_KEYS = ['sk_test_123', 'sk_test_placeholder', ''];

export interface InvoiceSummary {
  id: string;
  amount: number;
  currency: string;
  status: string;
  date: string;
  url: string | null;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  async createPortalSession(tenantId: string, returnUrl: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    // Sem customer ainda não há o que gerenciar no portal: o customer é criado
    // no primeiro checkout. Antes devolvíamos uma URL fictícia do Stripe.
    if (!tenant?.stripeId) {
      throw new ConflictException(
        'This organization has no billing account yet. Subscribe to a plan first.',
      );
    }
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripeId,
        return_url: this.safeReturnUrl(returnUrl),
      });
      return { url: session.url };
    } catch (err) {
      this.logger.warn(
        `Stripe billing portal failed for tenant ${tenantId}: ${(err as Error).message}`,
      );
      throw new BadGatewayException('Billing portal is unavailable right now.');
    }
  }

  /** Últimas faturas do customer no Stripe; vazio sem customer/Stripe ou em erro. */
  private async listInvoices(
    stripeId: string | null | undefined,
  ): Promise<InvoiceSummary[]> {
    const key = process.env.STRIPE_SECRET_KEY ?? '';
    if (!stripeId || DEV_STRIPE_KEYS.includes(key)) return [];
    try {
      const { data } = await stripe.invoices.list({
        customer: stripeId,
        limit: 12,
      });
      return data.map((inv) => ({
        id: inv.number || inv.id || '',
        amount: inv.status === 'paid' ? inv.amount_paid : inv.amount_due,
        currency: inv.currency,
        status: inv.status || 'draft',
        date: new Date(inv.created * 1000).toISOString(),
        url: inv.hosted_invoice_url ?? null,
      }));
    } catch (err) {
      this.logger.warn(
        `Stripe invoices unavailable for ${stripeId}: ${(err as Error).message}`,
      );
      return [];
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
    const invoices = await this.listInvoices(tenant?.stripeId);
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
      invoices,
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

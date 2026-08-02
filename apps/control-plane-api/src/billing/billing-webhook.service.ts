import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantLifecycleService } from '../tenants/tenant-lifecycle.service';
import { IamService } from '../iam/iam.service';
import { AuditService } from '../audit/audit.service';

/**
 * Orquestra o ciclo de vida do tenant dirigido por eventos de pagamento (#46).
 * Cada evento Stripe mapeia para uma transição idempotente da state machine:
 * - checkout.session.completed       => onboarding -> active (provisiona)
 * - invoice.payment_failed           => active -> past_due (graça 3-7 dias)
 * - customer.subscription.deleted    => past_due/active -> suspended
 * - customer.subscription.updated    => active|past_due|suspended (restaura + plano)
 */
@Injectable()
export class BillingWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantsService: TenantsService,
    private readonly lifecycle: TenantLifecycleService,
    private readonly iamService: IamService,
    private readonly auditService: AuditService,
    @InjectQueue('provisioner') private readonly provisionerQueue: Queue,
  ) {}

  async process(event: any): Promise<Record<string, unknown>> {
    if (!event?.id || !event?.type) {
      return { received: true, error: 'Invalid event' };
    }

    const existing = await this.prisma.webhookEvent.findUnique({
      where: { eventId: event.id },
    });
    if (existing) {
      return { received: true, duplicate: true };
    }

    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutCompleted(event);
      case 'invoice.payment_failed':
        return this.handlePaymentFailed(event);
      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(event);
      case 'customer.subscription.updated':
        return this.handleSubscriptionUpdated(event);
      default:
        await this.recordEvent(event, null);
        return { received: true, ignored: true };
    }
  }

  private async handleCheckoutCompleted(
    event: any,
  ): Promise<Record<string, unknown>> {
    const session = event.data.object;
    const { metadata, customer_email } = session;

    if (!metadata?.tenantName) {
      await this.recordEvent(event, null);
      return { received: true, error: 'No tenantName in metadata' };
    }

    const tenant = await this.tenantsService.createTenant(
      metadata.tenantName,
      metadata.plan,
      customer_email || 'customer@example.com',
      { state: 'onboarding', actorEmail: customer_email || null },
    );

    // Pagamento confirmado: onboarding -> active.
    await this.lifecycle.restoreActive(tenant.id, {
      reason: 'checkout.session.completed',
      actorEmail: customer_email || null,
    });

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

    await this.recordEvent(event, tenant.id);
    return { received: true, tenantId: tenant.id };
  }

  private async handlePaymentFailed(
    event: any,
  ): Promise<Record<string, unknown>> {
    const invoice = event.data.object;
    const tenant = await this.tenantByStripeId(invoice.customer);
    if (!tenant) {
      await this.recordEvent(event, null);
      return { received: true, error: 'Unknown customer' };
    }

    await this.lifecycle.enterPastDue(tenant.id, {
      reason: 'invoice.payment_failed',
      actorEmail: null,
    });

    await this.recordEvent(event, tenant.id);
    return { received: true, tenantId: tenant.id };
  }

  private async handleSubscriptionDeleted(
    event: any,
  ): Promise<Record<string, unknown>> {
    const subscription = event.data.object;
    const tenant = await this.tenantByStripeId(subscription.customer);
    if (!tenant) {
      await this.recordEvent(event, null);
      return { received: true, error: 'Unknown customer' };
    }

    await this.lifecycle.markSuspended(tenant.id, {
      reason: 'customer.subscription.deleted',
    });

    await this.recordEvent(event, tenant.id);
    return { received: true, tenantId: tenant.id };
  }

  private async handleSubscriptionUpdated(
    event: any,
  ): Promise<Record<string, unknown>> {
    const subscription = event.data.object;
    const tenant = await this.tenantByStripeId(subscription.customer);
    if (!tenant) {
      await this.recordEvent(event, null);
      return { received: true, error: 'Unknown customer' };
    }

    const status = subscription.status;

    // Sincroniza o plano a partir do preço da subscription (#36/#45).
    const priceId = subscription.items?.data?.[0]?.price?.id;
    if (priceId) {
      const plan = await this.prisma.billingPlan.findFirst({
        where: { stripePriceId: priceId },
      });
      if (plan && plan.slug !== tenant.plan) {
        await this.tenantsService.changePlan(tenant.id, plan.slug);
      }
    }

    if (status === 'active' || status === 'trialing') {
      await this.lifecycle.restoreActive(tenant.id, {
        reason: `customer.subscription.updated:${status}`,
      });
    } else if (status === 'past_due') {
      await this.lifecycle.enterPastDue(tenant.id, {
        reason: `customer.subscription.updated:${status}`,
      });
    } else if (status === 'canceled' || status === 'unpaid') {
      await this.lifecycle.markSuspended(tenant.id, {
        reason: `customer.subscription.updated:${status}`,
      });
    }

    await this.recordEvent(event, tenant.id);
    return { received: true, tenantId: tenant.id };
  }

  private async tenantByStripeId(stripeCustomerId: string | null | undefined) {
    if (!stripeCustomerId) return null;
    return this.prisma.tenant.findUnique({
      where: { stripeId: stripeCustomerId },
    });
  }

  private async recordEvent(event: any, tenantId: string | null) {
    await this.prisma.webhookEvent.create({
      data: {
        eventId: event.id,
        type: event.type,
        tenantId,
        payload: event as object,
      },
    });
    await this.auditService.record({
      action: 'billing.webhook_received',
      resourceType: 'WebhookEvent',
      resourceId: event.id,
      changes: { type: event.type, tenantId },
    });
  }
}

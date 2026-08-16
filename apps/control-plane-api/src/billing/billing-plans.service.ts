import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});

export interface BillingPlanInput {
  slug?: string;
  name?: string;
  description?: string;
  price?: number;
  currency?: string;
  cycle?: string;
  quotas?: Record<string, number>;
  features?: Record<string, boolean>;
  limitTypes?: Record<string, 'soft' | 'hard'>;
  status?: string;
  sortOrder?: number;
  syncStripe?: boolean;
  defaultDataIsolation?: string;
}

const DEV_STRIPE_KEYS = ['sk_test_123', 'sk_test_placeholder', ''];

@Injectable()
export class BillingPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listActive() {
    return this.prisma.billingPlan.findMany({
      where: { status: 'active' },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async listAll() {
    return this.prisma.billingPlan.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getBySlug(slug: string) {
    return this.prisma.billingPlan.findUnique({
      where: { slug },
    });
  }

  async create(
    input: BillingPlanInput,
    opts: { actorId?: string; actorEmail?: string; ip?: string } = {},
  ) {
    const slug = (input.slug ?? input.name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-');
    if (!slug) {
      throw new ConflictException('Plan slug is required');
    }
    const existing = await this.prisma.billingPlan.findUnique({
      where: { slug },
    });
    if (existing) {
      throw new ConflictException(`Plan with slug "${slug}" already exists`);
    }

    const stripeRefs = await this.syncStripe({
      slug,
      name: input.name || slug,
      price: input.price,
      currency: input.currency,
      cycle: input.cycle,
      enabled: input.syncStripe !== false,
    });

    const plan = await this.prisma.billingPlan.create({
      data: {
        slug,
        name: input.name || slug,
        description: input.description,
        price: input.price ?? 0,
        currency: input.currency || 'usd',
        cycle: input.cycle || 'monthly',
        quotas: (input.quotas || {}) as any,
        features: (input.features || {}) as any,
        limitTypes: (input.limitTypes || {}) as any,
        status: input.status || 'active',
        sortOrder: input.sortOrder ?? 0,
        defaultDataIsolation: (['SHARED', 'SCHEMA', 'DATABASE'].includes(input.defaultDataIsolation || '') ? input.defaultDataIsolation : undefined) as any,
        ...stripeRefs,
      },
    });

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      ip: opts.ip ?? null,
      action: 'billing_plan.created',
      resourceType: 'BillingPlan',
      resourceId: plan.slug,
      changes: {
        slug,
        name: plan.name,
        price: plan.price,
        currency: plan.currency,
        cycle: plan.cycle,
        status: plan.status,
      },
    });

    return plan;
  }

  async update(
    slug: string,
    input: BillingPlanInput,
    opts: { actorId?: string; actorEmail?: string; ip?: string } = {},
  ) {
    const existing = await this.prisma.billingPlan.findUnique({
      where: { slug },
    });
    if (!existing) {
      throw new NotFoundException(`Plan "${slug}" not found`);
    }

    let stripeRefs: Record<string, string> = {};
    const priceChanged =
      input.price !== undefined && input.price !== existing.price;
    const nameChanged =
      input.name !== undefined && input.name !== existing.name;

    if (input.syncStripe !== false && (priceChanged || nameChanged)) {
      stripeRefs = await this.syncStripe({
        slug,
        name: input.name || existing.name,
        price: input.price ?? existing.price,
        currency: input.currency || existing.currency,
        cycle: input.cycle || existing.cycle,
        enabled: true,
        existingProductId: existing.stripeProductId || undefined,
      });
    }

    const updated = await this.prisma.billingPlan.update({
      where: { slug },
      data: {
        name: input.name,
        description: input.description,
        price: input.price,
        currency: input.currency,
        cycle: input.cycle,
        quotas: input.quotas as any,
        features: input.features as any,
        limitTypes: input.limitTypes as any,
        status: input.status,
        sortOrder: input.sortOrder,
        defaultDataIsolation: (['SHARED', 'SCHEMA', 'DATABASE'].includes(input.defaultDataIsolation || '') ? input.defaultDataIsolation : undefined) as any,
        ...stripeRefs,
      },
    });

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      ip: opts.ip ?? null,
      action: 'billing_plan.updated',
      resourceType: 'BillingPlan',
      resourceId: updated.slug,
      changes: {
        slug,
        name: input.name,
        price: input.price,
        status: input.status,
        quotas: input.quotas,
        features: input.features,
      },
    });

    return updated;
  }

  async deactivate(
    slug: string,
    opts: { actorId?: string; actorEmail?: string; ip?: string } = {},
  ) {
    const existing = await this.prisma.billingPlan.findUnique({
      where: { slug },
    });
    if (!existing) {
      throw new NotFoundException(`Plan "${slug}" not found`);
    }
    const nextStatus = existing.status === 'active' ? 'inactive' : 'active';
    const updated = await this.prisma.billingPlan.update({
      where: { slug },
      data: { status: nextStatus },
    });

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      ip: opts.ip ?? null,
      action:
        nextStatus === 'active'
          ? 'billing_plan.activated'
          : 'billing_plan.deactivated',
      resourceType: 'BillingPlan',
      resourceId: updated.slug,
      changes: { slug, status: nextStatus },
    });

    return updated;
  }

  async remove(
    slug: string,
    opts: { actorId?: string; actorEmail?: string; ip?: string } = {},
  ) {
    const existing = await this.prisma.billingPlan.findUnique({
      where: { slug },
    });
    if (!existing) {
      throw new NotFoundException(`Plan "${slug}" not found`);
    }
    await this.prisma.billingPlan.delete({ where: { slug } });

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      ip: opts.ip ?? null,
      action: 'billing_plan.deleted',
      resourceType: 'BillingPlan',
      resourceId: existing.slug,
      changes: { slug, name: existing.name, price: existing.price },
    });

    return { deleted: true, slug };
  }

  private async syncStripe(params: {
    slug: string;
    name: string;
    price?: number;
    currency?: string;
    cycle?: string;
    enabled: boolean;
    existingProductId?: string;
  }): Promise<Record<string, string>> {
    const simulated = {
      stripeProductId: `prod_simulated_${params.slug}`,
      stripePriceId: `price_simulated_${params.slug}`,
    };

    if (
      !params.enabled ||
      !process.env.STRIPE_SECRET_KEY ||
      DEV_STRIPE_KEYS.includes(process.env.STRIPE_SECRET_KEY)
    ) {
      return simulated;
    }

    try {
      const product = params.existingProductId
        ? await stripe.products.update(params.existingProductId, {
            name: params.name,
            metadata: { slug: params.slug },
          })
        : await stripe.products.create({
            name: params.name,
            metadata: { slug: params.slug },
          });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: params.price ?? 0,
        currency: params.currency || 'usd',
        recurring: {
          interval: params.cycle === 'yearly' ? 'year' : 'month',
        },
      });

      return {
        stripeProductId: product.id,
        stripePriceId: price.id,
      };
    } catch (err: any) {
      console.warn(`[Stripe Sync Warning] ${err.message}`);
      return simulated;
    }
  }
}

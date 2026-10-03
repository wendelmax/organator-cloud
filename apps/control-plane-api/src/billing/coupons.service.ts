import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DEV_STRIPE_KEYS = ['sk_test_123', 'sk_test_placeholder', ''];
const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
const DURATIONS = ['once', 'forever', 'repeating'];

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});
const stripeEnabled = () =>
  !DEV_STRIPE_KEYS.includes(process.env.STRIPE_SECRET_KEY ?? '');

export interface CouponInput {
  code?: string;
  percentOff?: number | null;
  amountOff?: number | null;
  currency?: string;
  duration?: string;
  durationInMonths?: number | null;
  planSlugs?: string[];
  maxRedemptions?: number | null;
  expiresAt?: string | null;
}

/** Dados públicos de um cupom válido (o que o checkout mostra ao cliente). */
const publicView = (c: {
  code: string;
  percentOff: number | null;
  amountOff: number | null;
  currency: string;
  duration: string;
  durationInMonths: number | null;
}) => ({
  code: c.code,
  percentOff: c.percentOff,
  amountOff: c.amountOff,
  currency: c.currency,
  duration: c.duration,
  durationInMonths: c.durationInMonths,
});

/**
 * Cupons de desconto (#95): criados pelo admin da plataforma e espelhados no
 * Stripe (coupon + promotion code com o mesmo código). O checkout aplica o
 * promotion code; o uso é registrado pelo webhook do checkout concluído.
 */
@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CouponInput, actorId: string) {
    const code = String(input.code ?? '')
      .trim()
      .toUpperCase();
    if (!CODE_RE.test(code)) {
      throw new BadRequestException(
        'code must have 3-32 letters, digits, "-" or "_"',
      );
    }
    const percentOff = input.percentOff ?? null;
    const amountOff = input.amountOff ?? null;
    if ((percentOff === null) === (amountOff === null)) {
      throw new BadRequestException('Set either percentOff or amountOff');
    }
    if (
      percentOff !== null &&
      (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100)
    ) {
      throw new BadRequestException(
        'percentOff must be an integer between 1 and 100',
      );
    }
    if (amountOff !== null && (!Number.isInteger(amountOff) || amountOff < 1)) {
      throw new BadRequestException(
        'amountOff must be a positive integer in cents',
      );
    }
    const duration = input.duration ?? 'once';
    if (!DURATIONS.includes(duration)) {
      throw new BadRequestException(
        `duration must be one of ${DURATIONS.join(', ')}`,
      );
    }
    const durationInMonths =
      duration === 'repeating' ? (input.durationInMonths ?? null) : null;
    if (
      duration === 'repeating' &&
      (!Number.isInteger(durationInMonths) || durationInMonths! < 1)
    ) {
      throw new BadRequestException(
        'durationInMonths is required for repeating coupons',
      );
    }
    const maxRedemptions = input.maxRedemptions ?? null;
    if (
      maxRedemptions !== null &&
      (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)
    ) {
      throw new BadRequestException(
        'maxRedemptions must be a positive integer',
      );
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (
      expiresAt &&
      (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())
    ) {
      throw new BadRequestException('expiresAt must be a future date');
    }
    if (await this.prisma.coupon.findUnique({ where: { code } })) {
      throw new ConflictException('A coupon with this code already exists');
    }
    const currency = (input.currency || 'usd').toLowerCase();
    const planSlugs = (input.planSlugs ?? []).map((p) =>
      String(p).toLowerCase(),
    );

    let stripeCouponId: string | null = null;
    let stripePromotionCodeId: string | null = null;
    if (stripeEnabled()) {
      const coupon = await stripe.coupons.create({
        name: code,
        duration: duration,
        ...(durationInMonths ? { duration_in_months: durationInMonths } : {}),
        ...(percentOff !== null
          ? { percent_off: percentOff }
          : { amount_off: amountOff!, currency }),
        ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
        ...(expiresAt
          ? { redeem_by: Math.floor(expiresAt.getTime() / 1000) }
          : {}),
      });
      const promotion = await stripe.promotionCodes.create({
        promotion: { type: 'coupon', coupon: coupon.id },
        code,
      });
      stripeCouponId = coupon.id;
      stripePromotionCodeId = promotion.id;
    }

    const created = await this.prisma.coupon.create({
      data: {
        code,
        percentOff,
        amountOff,
        currency,
        duration,
        durationInMonths,
        planSlugs,
        maxRedemptions,
        expiresAt,
        stripeCouponId,
        stripePromotionCodeId,
        createdBy: actorId,
      },
    });
    await this.audit.record({
      actorId,
      action: 'billing.coupon_created',
      resourceType: 'Coupon',
      resourceId: created.id,
      changes: {
        code,
        percentOff,
        amountOff,
        currency,
        duration,
        planSlugs,
        maxRedemptions,
      },
    });
    return created;
  }

  list() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async deactivate(code: string, actorId: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: String(code).toUpperCase() },
    });
    if (!coupon) throw new NotFoundException('Coupon not found');
    if (coupon.stripePromotionCodeId && stripeEnabled()) {
      await stripe.promotionCodes.update(coupon.stripePromotionCodeId, {
        active: false,
      });
    }
    const updated = await this.prisma.coupon.update({
      where: { id: coupon.id },
      data: { active: false },
    });
    await this.audit.record({
      actorId,
      action: 'billing.coupon_deactivated',
      resourceType: 'Coupon',
      resourceId: coupon.id,
      changes: { code: coupon.code },
    });
    return updated;
  }

  /** Cupom aplicável ao plano agora (ativo, no prazo, com usos e escopo). */
  async findApplicable(code: string, planSlug: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: {
        code: String(code ?? '')
          .trim()
          .toUpperCase(),
      },
    });
    const invalid = (why: string) =>
      new BadRequestException(`Cupom inválido: ${why}`);
    if (!coupon || !coupon.active)
      throw invalid('não encontrado ou desativado');
    if (coupon.expiresAt && coupon.expiresAt <= new Date())
      throw invalid('expirado');
    if (
      coupon.maxRedemptions !== null &&
      coupon.redeemedCount >= coupon.maxRedemptions
    ) {
      throw invalid('limite de usos atingido');
    }
    const plans = (coupon.planSlugs as string[]) ?? [];
    if (plans.length && !plans.includes(String(planSlug).toLowerCase())) {
      throw invalid('não vale para este plano');
    }
    return coupon;
  }

  /** Validação pública para o cadastro mostrar o desconto antes do checkout. */
  async validate(code: string, planSlug: string) {
    return publicView(await this.findApplicable(code, planSlug));
  }

  /**
   * Registra o uso no checkout concluído (webhook). Incremento atômico que
   * respeita o limite; checkout repetido não conta duas vezes.
   */
  async redeem(
    code: string,
    context: { tenantId?: string | null; checkoutSessionId?: string | null },
  ) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: String(code).toUpperCase() },
    });
    if (!coupon) return { redeemed: false };
    if (context.checkoutSessionId) {
      const seen = await this.prisma.couponRedemption.findUnique({
        where: { checkoutSessionId: context.checkoutSessionId },
      });
      if (seen) return { redeemed: false };
    }
    const { count } = await this.prisma.coupon.updateMany({
      where: {
        id: coupon.id,
        ...(coupon.maxRedemptions !== null
          ? { redeemedCount: { lt: coupon.maxRedemptions } }
          : {}),
      },
      data: { redeemedCount: { increment: 1 } },
    });
    if (count === 0) return { redeemed: false };
    await this.prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        tenantId: context.tenantId ?? null,
        checkoutSessionId: context.checkoutSessionId ?? null,
      },
    });
    await this.audit.record({
      action: 'billing.coupon_redeemed',
      resourceType: 'Coupon',
      resourceId: coupon.id,
      changes: { code: coupon.code, tenantId: context.tenantId ?? null },
    });
    return { redeemed: true };
  }
}

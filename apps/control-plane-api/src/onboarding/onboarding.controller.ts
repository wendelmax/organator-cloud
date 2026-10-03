import {
  Controller,
  Post,
  Body,
  Req,
  Headers,
  BadRequestException,
  HttpCode,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { BillingPlansService } from '../billing/billing-plans.service';
import { BillingWebhookService } from '../billing/billing-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { AuditService } from '../audit/audit.service';
import { CouponsService } from '../billing/coupons.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Mesma resposta exista ou não a conta: o endpoint não revela e-mails. */
const SIGNUP_ACCEPTED = {
  accepted: true,
  message:
    'Se o e-mail puder ser usado, enviamos um link para ativar a conta e definir a senha.',
};
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});

@Controller('v1/onboarding')
export class OnboardingController {
  constructor(
    private readonly billingWebhook: BillingWebhookService,
    private readonly plansService: BillingPlansService,
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly coupons: CouponsService,
  ) {}

  /** Público: valida o cupom para o plano e devolve o desconto (para o cadastro). */
  @Get('coupons/:code')
  validateCoupon(@Param('code') code: string, @Query('plan') plan?: string) {
    return this.coupons.validate(code, String(plan || 'free').toLowerCase());
  }

  /**
   * Cadastro self-service em plano gratuito (os pagos passam pelo checkout).
   * Cria o tenant e envia ao dono o link de ativação, que também comprova o
   * e-mail. Um e-mail que já tem conta recebe a mesma resposta, sem criar nada.
   */
  @Post('signup')
  @HttpCode(202)
  async signup(
    @Req() req: any,
    @Body() body: { tenantName?: string; email?: string; plan?: string },
  ) {
    const tenantName =
      typeof body?.tenantName === 'string' ? body.tenantName.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (!tenantName || !EMAIL_RE.test(email)) {
      throw new BadRequestException(
        'tenantName and a valid email are required',
      );
    }
    const plan = await this.plansService.getBySlug(
      String(body.plan || 'free').toLowerCase(),
    );
    if (!plan || plan.status !== 'active' || plan.price > 0) {
      throw new BadRequestException(
        'Este plano exige pagamento: use o checkout.',
      );
    }

    if (await this.prisma.user.findUnique({ where: { email } })) {
      return SIGNUP_ACCEPTED;
    }
    const tenant = await this.tenants.createTenant(
      tenantName,
      plan.slug,
      email,
      {
        actorEmail: email,
      },
    );
    await this.audit.record({
      actorEmail: email,
      ip: req?.ip ?? null,
      action: 'onboarding.free_signup',
      resourceType: 'Tenant',
      resourceId: tenant.id,
      changes: { plan: plan.slug },
    });
    return SIGNUP_ACCEPTED;
  }

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

    // Cupom (#95): validado aqui e aplicado como promotion code do Stripe; o
    // uso é registrado pelo webhook do checkout concluído.
    const couponCode =
      typeof body?.coupon === 'string' && body.coupon.trim()
        ? body.coupon.trim().toUpperCase()
        : null;
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
    if (couponCode) {
      const coupon = await this.coupons.findApplicable(couponCode, planSlug);
      if (!coupon.stripePromotionCodeId) {
        throw new BadRequestException(
          'Cupom inválido: indisponível no checkout',
        );
      }
      discounts = [{ promotion_code: coupon.stripePromotionCodeId }];
    }
    const metadata = {
      tenantName,
      plan: planSlug,
      ...(couponCode ? { couponCode } : {}),
    };
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
      ...(discounts ? { discounts } : {}),
    });
    return { url: session.url };
  }
}

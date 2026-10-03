import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BillingService } from './billing.service';
import { CreditsService } from './credits.service';
import { CouponsService, type CouponInput } from './coupons.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly credits: CreditsService,
    private readonly coupons: CouponsService,
  ) {}

  @Get('coupons')
  @Roles('PLATFORM_ADMIN')
  listCoupons() {
    return this.coupons.list();
  }

  /** Cria o cupom (e o promotion code no Stripe, quando configurado). */
  @Post('coupons')
  @Roles('PLATFORM_ADMIN')
  createCoupon(@Req() req: any, @Body() body: CouponInput) {
    return this.coupons.create(body ?? {}, req.user.userId);
  }

  @Post('coupons/:code/deactivate')
  @Roles('PLATFORM_ADMIN')
  deactivateCoupon(@Req() req: any, @Param('code') code: string) {
    return this.coupons.deactivate(code, req.user.userId);
  }

  /** Saldo e extrato de créditos do próprio tenant. */
  @Get('credits')
  @Roles('OWNER', 'ADMIN', 'BILLING')
  creditStatement(@Req() req: any) {
    return this.credits.statement(req.user.tenantId);
  }

  @Get('tenants/:tenantId/credits')
  @Roles('PLATFORM_ADMIN')
  tenantCreditStatement(@Param('tenantId') tenantId: string) {
    return this.credits.statement(tenantId);
  }

  /** Concede crédito de cortesia (centavos), abatido das próximas faturas. */
  @Post('tenants/:tenantId/credits')
  @Roles('PLATFORM_ADMIN')
  grantCredit(
    @Req() req: any,
    @Param('tenantId') tenantId: string,
    @Body() body: { amount?: number; reason?: string; currency?: string },
  ) {
    return this.credits.grant(tenantId, body ?? {}, req.user.userId);
  }

  @Post('tenants/:tenantId/credits/:entryId/reverse')
  @Roles('PLATFORM_ADMIN')
  reverseCredit(
    @Req() req: any,
    @Param('tenantId') tenantId: string,
    @Param('entryId') entryId: string,
    @Body() body: { reason?: string },
  ) {
    return this.credits.reverse(tenantId, entryId, body ?? {}, req.user.userId);
  }

  @Post('create-portal-session')
  @Roles('OWNER', 'ADMIN', 'BILLING')
  async createPortalSession(
    @Req() req: any,
    @Body('returnUrl') returnUrl: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.billingService.createPortalSession(tenantId, returnUrl);
  }

  @Get('subscription')
  @Roles('OWNER', 'ADMIN', 'BILLING', 'MEMBER')
  async getSubscription(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.billingService.getSubscription(tenantId);
  }

  @Post('upgrade')
  @Roles('OWNER', 'ADMIN', 'BILLING')
  async upgrade(
    @Req() req: any,
    @Body() body: { plan: string; returnUrl?: string },
  ) {
    return this.billingService.createUpgradeSession(
      req.user.tenantId,
      body.plan,
      body.returnUrl,
      req.user.userId,
    );
  }
}

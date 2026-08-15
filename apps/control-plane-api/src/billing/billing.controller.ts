import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BillingService } from './billing.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

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

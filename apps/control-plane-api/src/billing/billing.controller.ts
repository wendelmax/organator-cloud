import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BillingService } from './billing.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN')
@Controller('v1/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('create-portal-session')
  async createPortalSession(
    @Req() req: any,
    @Body('returnUrl') returnUrl: string,
  ) {
    const tenantId = req.user?.tenantId || 'default-tenant';
    return this.billingService.createPortalSession(tenantId, returnUrl);
  }

  @Get('subscription')
  async getSubscription(@Req() req: any) {
    const tenantId = req.user?.tenantId || 'default-tenant';
    return this.billingService.getSubscription(tenantId);
  }
}

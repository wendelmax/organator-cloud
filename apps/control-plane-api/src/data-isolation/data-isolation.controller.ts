import { Controller, Get, Put, Post, Body, Param, Req, UseGuards, Sse } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { DataIsolationService } from './data-isolation.service';
import { DataIsolationEventsService } from './data-isolation-events.service';
import type { IsolationOverrideInput } from './data-isolation.types';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class DataIsolationController {
  constructor(
    private readonly service: DataIsolationService,
    private readonly eventsService: DataIsolationEventsService
  ) {}

  @Get('v1/tenants/data-isolation')
  @Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
  async getStatus(@Req() req: any) {
    return this.service.getStatus(req.user.tenantId);
  }

  @Put('v1/platform/tenants/:tenantId/data-isolation')
  @Roles('PLATFORM_ADMIN')
  async setOverride(
    @Param('tenantId') tenantId: string,
    @Body() body: IsolationOverrideInput,
    @Req() req: any,
  ) {
    return this.service.setOverride(tenantId, body, req.user.userId);
  }

  @Post('v1/platform/tenants/:tenantId/data-isolation/reconcile')
  @Roles('PLATFORM_ADMIN')
  async reconcile(@Param('tenantId') tenantId: string, @Req() req: any) {
    return this.service.reconcile(tenantId, req.user.userId);
  }

  @Sse('v1/tenants/data-isolation/stream/:deploymentId')
  @Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
  async stream(@Req() req: any, @Param('deploymentId') deploymentId: string) {
    return this.eventsService.stream({ tenantId: req.user.tenantId, deploymentId });
  }
}

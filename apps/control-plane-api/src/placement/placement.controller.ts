import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PlacementService } from './placement.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/placement')
export class PlacementController {
  constructor(private readonly placement: PlacementService) {}

  @Put('policy')
  @Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
  setPolicy(@Req() req: any, @Body() body: { provider?: string; region?: string; residencyRequired?: string; allowedProviders?: string[] }) {
    return this.placement.setPolicy(req.user.tenantId, body, req.user.userId);
  }

  @Post('migrations')
  @Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
  planMigration(@Req() req: any, @Body() body: { toRegionId: string }) {
    return this.placement.planMigration(req.user.tenantId, body.toRegionId, req.user.userId);
  }

  @Post('validate')
  @Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
  validate(@Req() req: any, @Body() body: { provider: string; region: string }) {
    return this.placement.validate({ tenantId: req.user.tenantId, provider: body.provider, region: body.region });
  }
}

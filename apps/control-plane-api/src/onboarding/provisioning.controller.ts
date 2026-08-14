import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ProvisioningService } from './provisioning.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
@Controller('v1/tenants/infrastructure')
export class ProvisioningController {
  constructor(private readonly provisioning: ProvisioningService) {}
  @Post('provision') provision(@Req() req: any) { return this.provisioning.provision(req.user.tenantId, req.user.userId); }
  @Post('deprovision') deprovision(@Req() req: any) { return this.provisioning.deprovision(req.user.tenantId, req.user.userId); }
}

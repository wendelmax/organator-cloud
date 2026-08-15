import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { InvitationsService } from './invitations.service';

@Controller('v1/tenant-invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
  @Get()
  list(@Req() req: any) { return this.invitations.list(req.user.tenantId); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
  @Post()
  create(@Req() req: any, @Body() body: { email: string; role?: string }) { return this.invitations.create(req.user.tenantId, body.email, body.role || 'MEMBER', req.user.userId); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
  @Delete(':id')
  revoke(@Req() req: any, @Param('id') id: string) { return this.invitations.revoke(req.user.tenantId, id, req.user.userId); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'PLATFORM_ADMIN')
  @Post(':id/resend')
  resend(@Req() req: any, @Param('id') id: string) { return this.invitations.resend(req.user.tenantId, id, req.user.userId); }

  @Post('accept')
  accept(@Body() body: { token: string; name?: string }) { return this.invitations.accept(body.token, body.name); }
}

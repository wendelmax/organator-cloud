import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DomainsService } from './domains.service';

@UseGuards(JwtAuthGuard)
@Controller('v1/domains')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Post()
  create(@Req() req: any, @Body() body: { hostname: string; provider: string; microserviceId?: string }) {
    return this.domains.create(req.user.tenantId, body, req.user.userId);
  }

  @Get()
  list(@Req() req: any) { return this.domains.list(req.user.tenantId, req.query.microserviceId); }

  @Get(':id/validate')
  validate(@Req() req: any, @Param('id') id: string) { return this.domains.validate(req.user.tenantId, id); }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) { return this.domains.remove(req.user.tenantId, id, req.user.userId); }
}

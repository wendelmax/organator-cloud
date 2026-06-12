import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ServicesService } from './services.service';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get('tenant/:tenantId')
  async findByTenant(@Param('tenantId') tenantId: string) {
    return this.servicesService.getServicesByTenant(tenantId);
  }

  @Post()
  async create(@Body() body: { tenantId: string; name: string; provider: 'VERCEL' | 'AWS' | 'DOCKER_VPS'; repositoryUrl: string }) {
    return this.servicesService.createService(body.tenantId, body.name, body.provider, body.repositoryUrl);
  }
}

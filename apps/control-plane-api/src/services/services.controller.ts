import { Controller, Post, Body, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServicesService } from './services.service';

@UseGuards(JwtAuthGuard)
@Controller('v1/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get('tenant/:tenantId')
  async findByTenant(@Param('tenantId') tenantId: string) {
    return this.servicesService.getServicesByTenant(tenantId);
  }

  @Post()
  async create(
    @Body()
    body: {
      tenantId: string;
      name: string;
      provider: 'VERCEL' | 'AWS' | 'DOCKER_VPS';
      repositoryUrl: string;
    },
  ) {
    return this.servicesService.createService(
      body.tenantId,
      body.name,
      body.provider,
      body.repositoryUrl,
    );
  }
}

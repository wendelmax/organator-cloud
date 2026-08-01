import { Controller, Post, Body, Get, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';

@UseGuards(JwtAuthGuard)
@Controller('v1/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get('tenant/:tenantId')
  async findByTenant(@Param('tenantId') tenantId: string) {
    return this.servicesService.getServicesByTenant(tenantId);
  }

  @Get(':id/deployments')
  async getDeployments(@Param('id') id: string) {
    return this.servicesService.getDeploymentsByService(id);
  }

  @Post(':id/deploy')
  async triggerDeploy(@Param('id') id: string) {
    return this.servicesService.triggerDeploy(id);
  }

  @Post()
  async create(@Body() body: CreateServiceDto) {
    const repo = body.repositoryUrl || body.repository;
    if (!repo) {
      throw new BadRequestException('repository or repositoryUrl is required');
    }
    return this.servicesService.createService(
      body.tenantId,
      body.name,
      body.cloudProvider,
      repo,
    );
  }
}

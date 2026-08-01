import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  BadRequestException,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';

@Controller('v1/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @UseGuards(JwtAuthGuard)
  @Get('tenant/:tenantId')
  async findByTenant(@Param('tenantId') tenantId: string) {
    return this.servicesService.getServicesByTenant(tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/deployments')
  async getDeployments(@Param('id') id: string) {
    return this.servicesService.getDeploymentsByService(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/deploy')
  async triggerDeploy(@Param('id') id: string) {
    return this.servicesService.triggerDeploy(id);
  }

  @UseGuards(JwtAuthGuard)
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

  @Sse('deployments/:id/stream')
  streamLogs(@Param('id') id: string): Observable<MessageEvent> {
    return this.servicesService.streamDeploymentLogs(id);
  }
}

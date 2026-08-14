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
  Request,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { QuotaGuard } from '../saas/quota.guard';
import { CheckQuota } from '../saas/quota.decorator';
import { ScopeGuard } from '../api-keys/scope.guard';
import { Scopes } from '../api-keys/scopes.decorator';
import { API_KEY_SCOPES } from '../api-keys/api-keys.types';
import { effectiveTenantFor } from '../api-keys/api-keys.util';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';

@Controller('v1/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @UseGuards(JwtAuthGuard, ScopeGuard)
  @Scopes(API_KEY_SCOPES.SERVICES_READ)
  @Get('tenant/:tenantId')
  async findByTenant(@Request() req: any, @Param('tenantId') tenantId: string) {
    return this.servicesService.getServicesByTenant(
      effectiveTenantFor(req, tenantId)!,
    );
  }

  @UseGuards(JwtAuthGuard, ScopeGuard)
  @Scopes(API_KEY_SCOPES.SERVICES_READ)
  @Get(':id/deployments')
  async getDeployments(@Param('id') id: string) {
    return this.servicesService.getDeploymentsByService(id);
  }

  @UseGuards(JwtAuthGuard, ScopeGuard, QuotaGuard)
  @CheckQuota('DEPLOYMENT')
  @Scopes(API_KEY_SCOPES.SERVICES_DEPLOY)
  @Post(':id/deploy')
  async triggerDeploy(@Param('id') id: string, @Body() body: { environment?: string }) {
    return this.servicesService.triggerDeploy(id, body?.environment);
  }

  @UseGuards(JwtAuthGuard, ScopeGuard, QuotaGuard)
  @CheckQuota('MICROSERVICE')
  @Scopes(API_KEY_SCOPES.SERVICES_WRITE)
  @Post()
  async create(@Request() req: any, @Body() body: CreateServiceDto) {
    const repo = body.repositoryUrl || body.repository;
    if (!repo) {
      throw new BadRequestException('repository or repositoryUrl is required');
    }
    return this.servicesService.createService(
      effectiveTenantFor(req, body.tenantId)!,
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

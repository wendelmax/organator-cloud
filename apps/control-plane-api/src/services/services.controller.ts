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
import {
  canActOnAnyTenant,
  effectiveTenantFor,
} from '../api-keys/api-keys.util';

/** Tenant a que a requisição se limita (null = qualquer, admin da plataforma). */
const scopeOf = (req: any): string | null =>
  canActOnAnyTenant(req) ? null : effectiveTenantFor(req);
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
      effectiveTenantFor(req, tenantId),
    );
  }

  @UseGuards(JwtAuthGuard, ScopeGuard)
  @Scopes(API_KEY_SCOPES.SERVICES_READ)
  @Get(':id/deployments')
  async getDeployments(@Request() req: any, @Param('id') id: string) {
    return this.servicesService.getDeploymentsByService(id, scopeOf(req));
  }

  @UseGuards(JwtAuthGuard, ScopeGuard, QuotaGuard)
  @CheckQuota('DEPLOYMENT')
  @Scopes(API_KEY_SCOPES.SERVICES_DEPLOY)
  @Post(':id/deploy')
  async triggerDeploy(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { environment?: string },
  ) {
    return this.servicesService.triggerDeploy(
      id,
      body?.environment,
      scopeOf(req),
    );
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
    const cloudProvider =
      body.cloudProvider === 'DOCKER_VPS' ? 'VPS' : body.cloudProvider;
    if (cloudProvider === 'VPS' && !body.image) {
      throw new BadRequestException('image is required for VPS services');
    }
    return this.servicesService.createService(
      effectiveTenantFor(req, body.tenantId),
      body.name,
      cloudProvider,
      repo,
      cloudProvider === 'VPS'
        ? { image: body.image, vpsHost: body.vpsHost }
        : {},
    );
  }

  // Antes era público: qualquer um com o id lia os logs de deploy ao vivo.
  @UseGuards(JwtAuthGuard, ScopeGuard)
  @Scopes(API_KEY_SCOPES.SERVICES_READ)
  @Sse('deployments/:id/stream')
  async streamLogs(
    @Request() req: any,
    @Param('id') id: string,
  ): Promise<Observable<MessageEvent>> {
    await this.servicesService.assertDeploymentInScope(id, scopeOf(req));
    return this.servicesService.streamDeploymentLogs(id);
  }
}

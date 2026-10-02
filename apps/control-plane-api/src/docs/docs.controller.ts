import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ScopeGuard } from '../api-keys/scope.guard';
import { Scopes } from '../api-keys/scopes.decorator';
import { API_KEY_SCOPES } from '../api-keys/api-keys.types';
import { DocsService } from './docs.service';
import { QuotaGuard } from '../saas/quota.guard';
import { CheckQuota } from '../saas/quota.decorator';
import {
  canActOnAnyTenant,
  effectiveTenantFor,
} from '../api-keys/api-keys.util';

/** Tenant a que a requisição se limita (null = qualquer, admin da plataforma). */
const scopeOf = (req: any): string | null =>
  canActOnAnyTenant(req) ? null : effectiveTenantFor(req);

@Controller('v1/docs')
export class DocsController {
  constructor(private readonly docsService: DocsService) {}

  @UseGuards(JwtAuthGuard, ScopeGuard, QuotaGuard)
  @CheckQuota('APIS')
  @Scopes(API_KEY_SCOPES.DOCS_WRITE)
  @Post()
  async create(
    @Request() req: any,
    @Body()
    body: {
      microserviceId: string;
      title: string;
      version: string;
      openApiSpec: string;
      isPublic?: boolean;
    },
  ) {
    return this.docsService.createDoc(
      body,
      effectiveTenantFor(req),
      scopeOf(req),
    );
  }

  @Get('public')
  async getPublic() {
    return this.docsService.getAllPublicDocs();
  }

  @UseGuards(JwtAuthGuard, ScopeGuard)
  @Scopes(API_KEY_SCOPES.DOCS_READ)
  @Get('service/:serviceId')
  async getByService(
    @Request() req: any,
    @Param('serviceId') serviceId: string,
  ) {
    return this.docsService.getDocsByService(serviceId, scopeOf(req));
  }

  @UseGuards(JwtAuthGuard, ScopeGuard)
  @Scopes(API_KEY_SCOPES.DOCS_WRITE)
  @Patch(':id/visibility')
  async toggleVisibility(
    @Request() req: any,
    @Param('id') id: string,
    @Body('isPublic') isPublic: boolean,
  ) {
    return this.docsService.toggleVisibility(id, isPublic, scopeOf(req));
  }
}

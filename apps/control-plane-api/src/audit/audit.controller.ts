import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AuditService } from './audit.service';
import type { AuditQuery } from './audit.service';

/**
 * Consulta de auditoria, somente leitura. O log não pode ser editado nem
 * apagado pela API — apenas a retenção (AuditCleanupService) remove dados.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('PLATFORM_ADMIN')
  async findAll(@Query() query: AuditQuery) {
    return this.auditService.findAll(query);
  }
}

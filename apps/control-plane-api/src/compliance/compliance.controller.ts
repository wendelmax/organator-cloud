import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ComplianceService } from './compliance.service';

/** Direitos do titular sobre os próprios dados (LGPD). */
@UseGuards(JwtAuthGuard)
@Controller('v1/compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /** Pede a exportação dos próprios dados; o arquivo é gerado em segundo plano. */
  @Post('export-request')
  requestExport(@Req() req: any) {
    return this.compliance.requestExport(req.user, req.ip);
  }

  /** Dataset de um tenant (DPO/compliance), só para o admin da plataforma. */
  @Post('tenants/:tenantId/export-request')
  @UseGuards(RolesGuard)
  @Roles('PLATFORM_ADMIN')
  requestTenantExport(@Req() req: any, @Param('tenantId') tenantId: string) {
    return this.compliance.requestTenantExport(req.user, tenantId, req.ip);
  }

  @Get('exports')
  listExports(@Req() req: any) {
    return this.compliance.listExports(req.user);
  }

  @Get('exports/:id/download')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="meus-dados.json"')
  @Header('Cache-Control', 'no-store')
  download(@Req() req: any, @Param('id') id: string) {
    return this.compliance.download(req.user, id, req.ip);
  }
}

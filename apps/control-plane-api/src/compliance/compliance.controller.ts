import {
  Controller,
  Get,
  Header,
  HttpCode,
  Body,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ComplianceService } from './compliance.service';
import { ErasureService } from './erasure.service';
import { RetentionService } from './retention.service';
import { ConsentService } from './consent.service';

/** Direitos do titular sobre os próprios dados (LGPD). */
@UseGuards(JwtAuthGuard)
@Controller('v1/compliance')
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly erasure: ErasureService,
    private readonly retention: RetentionService,
    private readonly consents: ConsentService,
  ) {}

  /** Consentimentos do titular: aceitos, pendentes e versões vigentes. */
  @Get('consents')
  consentStatus(@Req() req: any) {
    return this.consents.status(req.user);
  }

  /** Concede ou revoga uma finalidade (`{ purpose, granted }`). */
  @Post('consents')
  @HttpCode(200)
  updateConsent(
    @Req() req: any,
    @Body() body: { purpose?: string; granted?: boolean },
  ) {
    return this.consents.update(req.user, body ?? {}, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  /** Vista de conformidade de um titular (consentimentos e exportações). */
  @Get('users/:userId/summary')
  @UseGuards(RolesGuard)
  @Roles('PLATFORM_ADMIN')
  subjectSummary(@Param('userId') userId: string) {
    return this.consents.subjectSummary(userId);
  }

  /** Prazos de retenção em vigor, por tipo de dado (em dias). */
  @Get('retention-policy')
  @UseGuards(RolesGuard)
  @Roles('PLATFORM_ADMIN')
  retentionPolicy() {
    return this.retention.getPolicy();
  }

  /**
   * Direito ao esquecimento: apaga a própria conta e anonimiza os registros.
   * Confirma com a senha (ou o e-mail, em contas SSO). Irreversível.
   */
  @Post('erasure')
  @HttpCode(200)
  eraseSelf(
    @Req() req: any,
    @Body() body: { password?: string; email?: string },
  ) {
    return this.erasure.eraseSelf(req.user, body ?? {});
  }

  @Post('users/:userId/erasure')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('PLATFORM_ADMIN')
  eraseUser(@Req() req: any, @Param('userId') userId: string) {
    return this.erasure.eraseByAdmin(userId, req.user.userId);
  }

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

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IncidentsService } from './incidents.service';
import {
  CreateIncidentDto,
  UpdateIncidentDto,
  AddUpdateDto,
} from './dto/incident.dto';

/**
 * API de incidentes (#110). Todas as rotas são exclusivas do admin da
 * plataforma e o ator de auditoria vem sempre do JWT (`req.user`), nunca do
 * corpo — inclusive o authorEmail da timeline. Dedup de alertKey devolve o
 * incidente existente como 200 normal, sem 409.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  /** Lista paginada com filtros de status/severity/component. */
  @Get()
  @Roles('PLATFORM_ADMIN')
  list(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('component') component?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.incidents.list({
      status,
      severity,
      component,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  /** Abre um incidente; um alertKey ainda aberto devolve o incidente já existente. */
  @Post()
  @Roles('PLATFORM_ADMIN')
  create(@Req() req: any, @Body() body: CreateIncidentDto) {
    const actor = { userId: req.user.userId, email: req.user.email };
    return this.incidents.create(body, actor);
  }

  /** Incidente com a linha do tempo (updates) e o blast radius (affected). */
  @Get(':id')
  @Roles('PLATFORM_ADMIN')
  get(@Param('id') id: string) {
    return this.incidents.get(id);
  }

  @Patch(':id')
  @Roles('PLATFORM_ADMIN')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateIncidentDto,
  ) {
    const actor = { userId: req.user.userId, email: req.user.email };
    return this.incidents.update(id, body, actor);
  }

  /** Nova entrada na timeline; o autor sai do JWT e não do corpo. */
  @Post(':id/updates')
  @Roles('PLATFORM_ADMIN')
  addUpdate(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: AddUpdateDto,
  ) {
    const actor = { userId: req.user.userId, email: req.user.email };
    return this.incidents.addUpdate(id, body, actor);
  }

  /** Vincula um tenant ao incidente (já vinculado é noop, 200 mesmo assim). */
  @Post(':id/affected')
  @Roles('PLATFORM_ADMIN')
  async addAffected(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { tenantId: string },
  ) {
    const actor = { userId: req.user.userId, email: req.user.email };
    await this.incidents.addAffected(id, body.tenantId, actor);
    return { linked: true };
  }

  @Delete(':id/affected/:tenantId')
  @Roles('PLATFORM_ADMIN')
  async removeAffected(
    @Req() req: any,
    @Param('id') id: string,
    @Param('tenantId') tenantId: string,
  ) {
    const actor = { userId: req.user.userId, email: req.user.email };
    await this.incidents.removeAffected(id, tenantId, actor);
    return { removed: true };
  }
}

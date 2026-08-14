import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ProvidersService } from './providers.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLATFORM_ADMIN')
@Controller('v1/providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    if (!body?.type || !body?.name) {
      throw new BadRequestException('type and name are required');
    }
    return this.providersService.create(
      {
        type: body.type,
        name: body.name,
        secrets: body.secrets ?? {},
        config: body.config ?? {},
      },
      req.user?.userId ?? null,
    );
  }

  @Get()
  async list() {
    return this.providersService.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.providersService.get(id);
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.providersService.update(
      id,
      {
        name: body.name,
        secrets: body.secrets,
        config: body.config,
      },
      req.user?.userId ?? null,
    );
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.providersService.remove(id, req.user?.userId ?? null);
    return { deleted: true };
  }

  @Post(':id/test-connection')
  async testConnection(@Param('id') id: string) {
    return this.providersService.testConnection(id);
  }

  @Post('profiles')
  async createProfile(@Req() req: any, @Body() body: any) {
    return this.providersService.createProfile({ name: body.name, type: body.type, credentialId: body.credentialId, tenantId: body.tenantId ?? null, config: body.config ?? {}, isDefault: body.isDefault }, req.user?.userId ?? null);
  }

  @Get('profiles/list')
  async listProfiles(@Req() req: any) {
    return this.providersService.listProfiles(req.user?.tenantId ?? null);
  }
}

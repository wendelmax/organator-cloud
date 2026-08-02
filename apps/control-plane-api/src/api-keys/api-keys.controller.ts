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
import { ApiKeysService } from './api-keys.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLATFORM_ADMIN')
@Controller('v1/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    if (!body?.name) {
      throw new BadRequestException('Name is required');
    }
    return this.apiKeysService.create({
      name: body.name,
      scopes: body.scopes,
      tenantId: body.tenantId,
      expiresAt: body.expiresAt,
      createdBy: req.user?.userId ?? null,
    });
  }

  @Get()
  async list() {
    return this.apiKeysService.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.apiKeysService.get(id);
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.apiKeysService.update(
      id,
      {
        name: body.name,
        scopes: body.scopes,
        expiresAt: body.expiresAt,
        tenantId: body.tenantId,
      },
      req.user?.userId ?? null,
    );
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.apiKeysService.delete(id, req.user?.userId ?? null);
    return { deleted: true };
  }
}

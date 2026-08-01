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
import { TenantsService } from './tenants.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  async findAll() {
    return this.tenantsService.getTenants();
  }

  @Post()
  async create(
    @Body() body: { name: string; plan: string; adminEmail: string },
  ) {
    return this.tenantsService.createTenant(
      body.name,
      body.plan,
      body.adminEmail,
    );
  }

  @Get('members')
  async getMembers(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.tenantsService.getMembers(tenantId);
  }

  @Post('members')
  @Roles('OWNER', 'ADMIN')
  async addMember(
    @Req() req: any,
    @Body()
    body: {
      email: string;
      name?: string;
      role?: string;
      password?: string;
      tenantId?: string;
    },
  ) {
    const tenantId = req.user?.tenantId || body.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    if (!body.email) {
      throw new BadRequestException('Email is required');
    }
    return this.tenantsService.addMember(
      tenantId,
      body.email,
      body.name,
      body.role,
      body.password,
    );
  }

  @Patch('members/:userId/role')
  @Roles('OWNER', 'ADMIN')
  async updateMemberRole(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: { role: string; tenantId?: string },
  ) {
    const tenantId = req.user?.tenantId || body.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    if (!body.role) {
      throw new BadRequestException('Role is required');
    }
    return this.tenantsService.updateMemberRole(tenantId, userId, body.role);
  }

  @Delete('members/:userId')
  @Roles('OWNER')
  async removeMember(@Req() req: any, @Param('userId') userId: string) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.tenantsService.removeMember(tenantId, userId);
  }
}

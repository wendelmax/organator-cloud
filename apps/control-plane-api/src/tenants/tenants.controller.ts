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
import { EntitlementsService } from '../entitlements/entitlements.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('v1/tenants')
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  @Get()
  @Roles('PLATFORM_ADMIN')
  async findAll() {
    return this.tenantsService.getTenants();
  }

  @Get('members')
  async getMembers(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.tenantsService.getMembers(tenantId);
  }

  @Get('available')
  async availableTenants(@Req() req: any) { return this.tenantsService.listMemberships(req.user.userId); }

  @Get('context/:slug')
  async resolveContext(@Req() req: any, @Param('slug') slug: string) { return this.tenantsService.resolveMembership(req.user.userId, slug); }

  @Get('current/settings')
  @Roles('OWNER', 'ADMIN')
  async currentSettings(@Req() req: any) { return this.tenantsService.getTenant(req.user.tenantId); }

  @Patch('current/settings')
  @Roles('OWNER', 'ADMIN')
  async updateCurrentSettings(@Req() req: any, @Body() body: { name?: string; slug?: string }) {
    return this.tenantsService.updateTenant(req.user.tenantId, body);
  }

  @Get(':id/metrics')
  @Roles('PLATFORM_ADMIN')
  async getTenantMetrics(@Param('id') id: string) {
    return this.tenantsService.getTenantMetrics(id);
  }

  @Get(':id/quota-usage')
  @Roles('PLATFORM_ADMIN')
  async getTenantQuotaUsage(@Param('id') id: string) {
    return this.tenantsService.getTenantQuotaUsage(id);
  }

  @Get(':id/entitlements')
  @Roles('PLATFORM_ADMIN')
  async getTenantEntitlements(@Param('id') id: string) {
    return this.entitlementsService.resolve(id);
  }

  @Get(':id')
  @Roles('PLATFORM_ADMIN')
  async findOne(@Param('id') id: string) {
    return this.tenantsService.getTenant(id);
  }

  @Post(':id/provision-infra')
  @Roles('PLATFORM_ADMIN')
  async triggerInfraProvisioning(@Param('id') id: string, @Req() req: any) {
    return this.tenantsService.triggerInfraProvisioning(id, req.user?.userId);
  }

  @Post(':id/backups')
  @Roles('PLATFORM_ADMIN')
  async triggerBackup(@Param('id') id: string) {
    return this.tenantsService.triggerBackup(id);
  }

  @Get(':id/backups')
  @Roles('PLATFORM_ADMIN')
  async getBackups(@Param('id') id: string) {
    return this.tenantsService.getBackups(id);
  }

  @Post(':id/restore')
  @Roles('PLATFORM_ADMIN')
  async triggerRestore(@Param('id') id: string, @Body() body: { backupId: string }) {
    if (!body.backupId) throw new BadRequestException('backupId is required');
    return this.tenantsService.triggerRestore(id, body.backupId);
  }

  @Post(':id/clone')
  @Roles('PLATFORM_ADMIN')
  async triggerClone(@Param('id') id: string, @Body() body: { targetSlug: string; targetName: string }) {
    if (!body.targetSlug || !body.targetName) throw new BadRequestException('targetSlug and targetName are required');
    return this.tenantsService.triggerClone(id, body.targetSlug, body.targetName);
  }

  @Delete(':id/offboard')
  @Roles('PLATFORM_ADMIN')
  async triggerOffboard(@Param('id') id: string) {
    return this.tenantsService.triggerOffboard(id);
  }

  @Post()
  @Roles('PLATFORM_ADMIN')
  async create(
    @Body() body: { name: string; plan: string; adminEmail: string },
  ) {
    if (!body.name) {
      throw new BadRequestException('Name is required');
    }
    return this.tenantsService.createTenant(
      body.name,
      body.plan,
      body.adminEmail,
    );
  }

  @Patch(':id')
  @Roles('PLATFORM_ADMIN')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; slug?: string },
  ) {
    return this.tenantsService.updateTenant(id, body);
  }

  @Patch(':id/plan')
  @Roles('PLATFORM_ADMIN')
  async changePlan(@Param('id') id: string, @Body() body: { plan: string }, @Req() req: any) {
    if (!body.plan) {
      throw new BadRequestException('Plan is required');
    }
    return this.tenantsService.changePlan(id, body.plan, req.user?.userId);
  }

  @Post(':id/suspend')
  @Roles('PLATFORM_ADMIN')
  async suspendTenant(@Param('id') id: string) {
    return this.tenantsService.suspendTenant(id);
  }

  @Post(':id/reactivate')
  @Roles('PLATFORM_ADMIN')
  async reactivateTenant(@Param('id') id: string) {
    return this.tenantsService.reactivateTenant(id);
  }

  @Post(':id/archive')
  @Roles('PLATFORM_ADMIN')
  async archiveTenant(@Param('id') id: string) {
    return this.tenantsService.archiveTenant(id);
  }

  @Post(':id/transfer-ownership')
  @Roles('PLATFORM_ADMIN')
  async transferOwnership(
    @Param('id') id: string,
    @Body() body: { newOwnerId: string },
  ) {
    if (!body.newOwnerId) {
      throw new BadRequestException('newOwnerId is required');
    }
    return this.tenantsService.transferOwnership(id, body.newOwnerId);
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
      { actorId: req.user?.sub, actorEmail: req.user?.email, ip: req.ip },
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
    return this.tenantsService.updateMemberRole(tenantId, userId, body.role, {
      actorId: req.user?.sub,
      actorEmail: req.user?.email,
      ip: req.ip,
    });
  }

  @Delete('members/:userId')
  @Roles('OWNER')
  async removeMember(@Req() req: any, @Param('userId') userId: string) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.tenantsService.removeMember(tenantId, userId, {
      actorId: req.user?.sub,
      actorEmail: req.user?.email,
      ip: req.ip,
    });
  }
}

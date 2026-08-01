import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantsService } from './tenants.service';

@UseGuards(JwtAuthGuard)
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
}

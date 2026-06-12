import { Controller, Get, Post, Body } from '@nestjs/common';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  async findAll() {
    return this.tenantsService.getTenants();
  }

  @Post()
  async create(@Body() body: { name: string; plan: string; adminEmail: string }) {
    return this.tenantsService.createTenant(body.name, body.plan, body.adminEmail);
  }
}

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
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BillingPlansService } from './billing-plans.service';
import type { BillingPlanInput } from './billing-plans.service';

@Controller('v1/billing/plans')
export class BillingPlansController {
  constructor(private readonly plansService: BillingPlansService) {}

  @Get()
  listActive() {
    return this.plansService.listActive();
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PLATFORM_ADMIN')
  listAll() {
    return this.plansService.listAll();
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.plansService.getBySlug(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PLATFORM_ADMIN')
  create(@Req() req: any, @Body() body: BillingPlanInput) {
    return this.plansService.create(body, {
      actorId: req.user?.sub,
      actorEmail: req.user?.email,
      ip: req.ip,
    });
  }

  @Patch(':slug')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PLATFORM_ADMIN')
  update(
    @Req() req: any,
    @Param('slug') slug: string,
    @Body() body: BillingPlanInput,
  ) {
    return this.plansService.update(slug, body, {
      actorId: req.user?.sub,
      actorEmail: req.user?.email,
      ip: req.ip,
    });
  }

  @Delete(':slug')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PLATFORM_ADMIN')
  deactivate(@Req() req: any, @Param('slug') slug: string) {
    return this.plansService.deactivate(slug, {
      actorId: req.user?.sub,
      actorEmail: req.user?.email,
      ip: req.ip,
    });
  }
}

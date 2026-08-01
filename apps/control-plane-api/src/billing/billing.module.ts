import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingPlansController } from './billing-plans.controller';
import { BillingPlansService } from './billing-plans.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [BillingController, BillingPlansController],
  providers: [BillingService, BillingPlansService, PrismaService],
  exports: [BillingService, BillingPlansService],
})
export class BillingModule {}

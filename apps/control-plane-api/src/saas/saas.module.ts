import { Module } from '@nestjs/common';
import { SaasService } from './saas.service';
import { QuotaGuard } from './quota.guard';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [SaasService, QuotaGuard, PrismaService],
  exports: [SaasService, QuotaGuard],
})
export class SaasModule {}

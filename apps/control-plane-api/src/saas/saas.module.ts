import { Module } from '@nestjs/common';
import { QuotaGuard } from './quota.guard';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [EntitlementsModule],
  providers: [QuotaGuard, PrismaService],
  exports: [QuotaGuard],
})
export class SaasModule {}

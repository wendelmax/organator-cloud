import { Module } from '@nestjs/common';
import { QuotaGuard } from './quota.guard';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [EntitlementsModule],
  providers: [QuotaGuard],
  exports: [QuotaGuard],
})
export class SaasModule {}

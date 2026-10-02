import { Module } from '@nestjs/common';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { AuditModule } from '../audit/audit.module';
import { SaasModule } from '../saas/saas.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [AuditModule, SaasModule, EntitlementsModule],
  controllers: [DomainsController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}

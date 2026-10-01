import { Module } from '@nestjs/common';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [DomainsController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}

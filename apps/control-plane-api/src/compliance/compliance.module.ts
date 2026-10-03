import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../audit/audit.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ErasureService } from './erasure.service';
import { RetentionService } from './retention.service';

@Module({
  imports: [AuditModule, BullModule.registerQueue({ name: 'provisioner' })],
  controllers: [ComplianceController],
  providers: [ComplianceService, ErasureService, RetentionService],
})
export class ComplianceModule {}

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../audit/audit.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ErasureService } from './erasure.service';

@Module({
  imports: [AuditModule, BullModule.registerQueue({ name: 'provisioner' })],
  controllers: [ComplianceController],
  providers: [ComplianceService, ErasureService],
})
export class ComplianceModule {}

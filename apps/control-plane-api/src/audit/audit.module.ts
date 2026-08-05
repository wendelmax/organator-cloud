import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditCleanupService } from './audit-cleanup.service';
import { AuditController } from './audit.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditCleanupService, PrismaService],
  exports: [AuditService],
})
export class AuditModule {}

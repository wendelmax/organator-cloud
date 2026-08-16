import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DataIsolationController } from './data-isolation.controller';
import { DataIsolationService } from './data-isolation.service';
import { DataIsolationEventsService } from './data-isolation-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    AuditModule,
    BullModule.registerQueue({ name: 'provisioner' }),
  ],
  controllers: [DataIsolationController],
  providers: [DataIsolationService, DataIsolationEventsService, PrismaService],
  exports: [DataIsolationService, DataIsolationEventsService],
})
export class DataIsolationModule {}

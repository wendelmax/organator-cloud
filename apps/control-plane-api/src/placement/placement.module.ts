import { Module } from '@nestjs/common';
import { PlacementService } from './placement.service';
import { PlacementController } from './placement.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [PlacementController],
  providers: [PlacementService],
  exports: [PlacementService],
})
export class PlacementModule {}

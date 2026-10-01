import { Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';
import { FeatureGuard } from './feature.guard';

@Module({
  providers: [EntitlementsService, FeatureGuard],
  exports: [EntitlementsService, FeatureGuard],
})
export class EntitlementsModule {}

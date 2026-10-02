import { Module } from '@nestjs/common';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';
import { SaasModule } from '../saas/saas.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [SaasModule, EntitlementsModule],
  controllers: [DocsController],
  providers: [DocsService],
  exports: [DocsService],
})
export class DocsModule {}

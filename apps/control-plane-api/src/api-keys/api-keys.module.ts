import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyStrategy } from './api-key.strategy';
import { ScopeGuard } from './scope.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyStrategy, ScopeGuard, PrismaService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}

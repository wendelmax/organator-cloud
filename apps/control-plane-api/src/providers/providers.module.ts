import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [ProvidersController],
  providers: [ProvidersService, PrismaService],
  exports: [ProvidersService],
})
export class ProvidersModule {}

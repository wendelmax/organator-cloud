import { Module } from '@nestjs/common';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [DocsController],
  providers: [DocsService, PrismaService],
  exports: [DocsService],
})
export class DocsModule {}

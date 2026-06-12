import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [ServicesController],
  providers: [ServicesService, PrismaService],
})
export class ServicesModule {}

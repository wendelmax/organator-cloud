import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { PrismaService } from '../prisma/prisma.service';
import { SaasModule } from '../saas/saas.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'provisioner',
    }),
    SaasModule,
  ],
  controllers: [ServicesController],
  providers: [ServicesService, PrismaService],
  exports: [ServicesService],
})
export class ServicesModule {}

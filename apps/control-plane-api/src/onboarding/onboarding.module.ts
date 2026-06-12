import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OnboardingController } from './onboarding.controller';
import { TenantsService } from '../tenants/tenants.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'provisioner',
    }),
  ],
  controllers: [OnboardingController],
  providers: [TenantsService, PrismaService],
})
export class OnboardingModule {}

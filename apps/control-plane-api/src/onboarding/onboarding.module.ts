import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { BillingModule } from '../billing/billing.module';
import { BullModule } from '@nestjs/bullmq';
import { ProvisioningService } from './provisioning.service';
import { ProvisioningController } from './provisioning.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [BillingModule, AuditModule, BullModule.registerQueue({ name: 'provisioner' })],
  controllers: [OnboardingController, ProvisioningController],
  providers: [ProvisioningService, PrismaService],
})
export class OnboardingModule {}

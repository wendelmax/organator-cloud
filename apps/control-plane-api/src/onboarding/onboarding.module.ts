import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OnboardingController } from './onboarding.controller';
import { TenantsService } from '../tenants/tenants.service';
import { IamModule } from '../iam/iam.module';
import { BillingModule } from '../billing/billing.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'provisioner',
    }),
    IamModule,
    BillingModule,
    EntitlementsModule,
  ],
  controllers: [OnboardingController],
  providers: [TenantsService, PrismaService],
})
export class OnboardingModule {}

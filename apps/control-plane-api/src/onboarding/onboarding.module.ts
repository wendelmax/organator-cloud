import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { BillingModule } from '../billing/billing.module';
import { BullModule } from '@nestjs/bullmq';
import { ProvisioningService } from './provisioning.service';
import { ProvisioningController } from './provisioning.controller';
import { AuditModule } from '../audit/audit.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [
    BillingModule,
    AuditModule,
    TenantsModule,
    BullModule.registerQueue({ name: 'provisioner' }),
  ],
  controllers: [OnboardingController, ProvisioningController],
  providers: [ProvisioningService],
})
export class OnboardingModule {}

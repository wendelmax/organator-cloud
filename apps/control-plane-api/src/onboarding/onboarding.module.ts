import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [OnboardingController],
})
export class OnboardingModule {}

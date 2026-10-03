import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CreditsService } from './credits.service';
import { CouponsService } from './coupons.service';
import { DunningService } from './dunning.service';
import { BillingPlansController } from './billing-plans.controller';
import { BillingPlansService } from './billing-plans.service';
import { BillingWebhookService } from './billing-webhook.service';
import { TenantsModule } from '../tenants/tenants.module';
import { IamModule } from '../iam/iam.module';
import { AuditModule } from '../audit/audit.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'provisioner',
    }),
    TenantsModule,
    IamModule,
    AuditModule,
    EntitlementsModule,
  ],
  controllers: [BillingController, BillingPlansController],
  providers: [
    BillingService,
    BillingPlansService,
    BillingWebhookService,
    CreditsService,
    CouponsService,
    DunningService,
  ],
  exports: [
    BillingService,
    BillingPlansService,
    BillingWebhookService,
    CouponsService,
  ],
})
export class BillingModule {}

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantsModule } from './tenants/tenants.module';
import { ServicesModule } from './services/services.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AuthModule } from './auth/auth.module';
import { DocsModule } from './docs/docs.module';
import { BillingModule } from './billing/billing.module';
import { SaasModule } from './saas/saas.module';
import { IamModule } from './iam/iam.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    }),
    TenantsModule,
    ServicesModule,
    OnboardingModule,
    AuthModule,
    DocsModule,
    BillingModule,
    SaasModule,
    IamModule,
    EntitlementsModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

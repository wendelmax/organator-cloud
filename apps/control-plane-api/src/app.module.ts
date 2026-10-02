import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { QueueUnavailableFilter } from './common/queue-unavailable.filter';
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
import { ApiKeysModule } from './api-keys/api-keys.module';
import { ProvidersModule } from './providers/providers.module';
import { PlacementModule } from './placement/placement.module';
import { DomainsModule } from './domains/domains.module';
import { DataIsolationModule } from './data-isolation/data-isolation.module';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        // A API só produz jobs: com o Redis fora, falha na hora (503) em vez
        // de segurar a requisição indefinidamente na fila offline do ioredis.
        enableOfflineQueue: false,
      },
    }),
    PrismaModule,
    MailModule,
    HealthModule,
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
    ApiKeysModule,
    ProvidersModule,
    PlacementModule,
    DomainsModule,
    DataIsolationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: QueueUnavailableFilter },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantsModule } from './tenants/tenants.module';
import { ServicesModule } from './services/services.module';
import { OnboardingModule } from './onboarding/onboarding.module';

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
    OnboardingModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

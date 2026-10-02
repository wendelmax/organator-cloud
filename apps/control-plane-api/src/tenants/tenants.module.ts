import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { TenantStateGuard } from './tenant-state.guard';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { SaasModule } from '../saas/saas.module';
import { AuditModule } from '../audit/audit.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PasswordResetModule } from '../auth/password-reset.module';
import { jwtConstants } from '../auth/auth.module';
import { BullModule } from '@nestjs/bullmq';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';

@Module({
  imports: [
    EntitlementsModule,
    SaasModule,
    AuditModule,
    ApiKeysModule,
    PasswordResetModule,
    BullModule.registerQueue({ name: 'provisioner' }),
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [TenantsController, InvitationsController],
  providers: [
    TenantsService,
    InvitationsService,
    TenantLifecycleService,
    {
      provide: APP_GUARD,
      useClass: TenantStateGuard,
    },
  ],
  exports: [TenantsService, TenantLifecycleService],
})
export class TenantsModule {}

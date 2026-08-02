import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { TenantStateGuard } from './tenant-state.guard';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { AuditModule } from '../audit/audit.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { jwtConstants } from '../auth/auth.module';

@Module({
  imports: [
    EntitlementsModule,
    AuditModule,
    ApiKeysModule,
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [TenantsController],
  providers: [
    TenantsService,
    TenantLifecycleService,
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: TenantStateGuard,
    },
  ],
  exports: [TenantsService, TenantLifecycleService],
})
export class TenantsModule {}

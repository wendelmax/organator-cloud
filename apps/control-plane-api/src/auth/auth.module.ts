import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { OidcStrategy } from './oidc.strategy';
import { MfaService } from './mfa.service';

import { RolesGuard } from './roles.guard';
import { AuditModule } from '../audit/audit.module';
import { readSecurityConfig } from '../common/security.config';
import { MfaPolicyService } from './mfa-policy.service';
import { PasswordResetModule } from './password-reset.module';
import { PasswordPolicyController } from './password-policy.controller';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ImpersonationService } from './impersonation.service';
import { ImpersonationInterceptor } from './impersonation.interceptor';

const securityConfig = readSecurityConfig();

export const jwtConstants = {
  secret: securityConfig.jwtSecret,
};

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '1d' },
    }),
    AuditModule,
    PasswordResetModule,
  ],
  controllers: [AuthController, PasswordPolicyController],
  providers: [
    AuthService,
    JwtStrategy,
    OidcStrategy,
    MfaService,
    MfaPolicyService,
    RolesGuard,
    ImpersonationService,
    { provide: APP_INTERCEPTOR, useClass: ImpersonationInterceptor },
  ],
  exports: [AuthService, RolesGuard, MfaService],
})
export class AuthModule {}

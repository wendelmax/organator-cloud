import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { OidcStrategy } from './oidc.strategy';
import { MfaService } from './mfa.service';
import { PrismaService } from '../prisma/prisma.service';

import { RolesGuard } from './roles.guard';
import { AuditModule } from '../audit/audit.module';
import { readSecurityConfig } from '../common/security.config';

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
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    OidcStrategy,
    MfaService,
    PrismaService,
    RolesGuard,
  ],
  exports: [AuthService, RolesGuard, MfaService],
})
export class AuthModule {}

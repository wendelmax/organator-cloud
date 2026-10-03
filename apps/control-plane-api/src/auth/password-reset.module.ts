import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PasswordResetService } from './password-reset.service';
import { PasswordPolicyService } from './password-policy.service';

// Módulo próprio para o TenantsModule usar sem importar o AuthModule inteiro.
@Module({
  imports: [AuditModule],
  providers: [PasswordResetService, PasswordPolicyService],
  exports: [PasswordResetService, PasswordPolicyService],
})
export class PasswordResetModule {}

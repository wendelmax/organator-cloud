import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PasswordResetService } from './password-reset.service';

// Módulo próprio para o TenantsModule usar sem importar o AuthModule inteiro.
@Module({
  imports: [AuditModule],
  providers: [PasswordResetService],
  exports: [PasswordResetService],
})
export class PasswordResetModule {}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuditService } from './audit.service';

const RETENTION_DAYS_DEFAULT = 90;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Retenção de auditoria configurável via AUDIT_RETENTION_DAYS (padrão 90).
 * Roda uma vez na inicialização e diariamente em seguida.
 */
@Injectable()
export class AuditCleanupService implements OnModuleInit {
  private readonly logger = new Logger(AuditCleanupService.name);

  constructor(private readonly auditService: AuditService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const retentionDays =
      Number(process.env.AUDIT_RETENTION_DAYS) || RETENTION_DAYS_DEFAULT;
    this.run(retentionDays);
    setInterval(() => {
      void this.run(retentionDays);
    }, CLEANUP_INTERVAL_MS);
  }

  private async run(retentionDays: number) {
    try {
      const deleted = await this.auditService.cleanup(retentionDays);
      if (deleted > 0) {
        this.logger.log(
          `Audit cleanup: ${deleted} registro(s) removido(s) (retenção ${retentionDays} dias)`,
        );
      }
    } catch (err) {
      this.logger.warn(`Audit cleanup falhou: ${(err as Error).message}`);
    }
  }
}

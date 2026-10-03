import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = DAY_MS;

/** Prazo de retenção por tipo de dado (dias), configurável por variável de ambiente. */
export interface RetentionPolicy {
  webhookEvents: number;
  sessions: number;
  passwordTokens: number;
  mfaChallenges: number;
  invitations: number;
  dataExports: number;
  backups: number;
  auditLogs: number;
}

const DEFAULTS: RetentionPolicy = {
  webhookEvents: 90,
  sessions: 30,
  passwordTokens: 7,
  mfaChallenges: 1,
  invitations: 90,
  dataExports: 30,
  backups: 7,
  auditLogs: 90,
};

const ENV: Record<keyof RetentionPolicy, string> = {
  webhookEvents: 'RETENTION_WEBHOOK_EVENTS_DAYS',
  sessions: 'RETENTION_SESSIONS_DAYS',
  passwordTokens: 'RETENTION_PASSWORD_TOKENS_DAYS',
  mfaChallenges: 'RETENTION_MFA_CHALLENGES_DAYS',
  invitations: 'RETENTION_INVITATIONS_DAYS',
  dataExports: 'RETENTION_DATA_EXPORTS_DAYS',
  backups: 'RETENTION_BACKUPS_DAYS',
  // Nome já existente (AuditCleanupService).
  auditLogs: 'AUDIT_RETENTION_DAYS',
};

export function retentionPolicy(
  env: NodeJS.ProcessEnv = process.env,
): RetentionPolicy {
  const policy = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof RetentionPolicy)[]) {
    const parsed = Number(env[ENV[key]]);
    if (Number.isInteger(parsed) && parsed > 0) policy[key] = parsed;
  }
  return policy;
}

/**
 * Política contínua de retenção (LGPD, #108): apaga diariamente o que passou do
 * prazo em cada tipo de dado. A auditoria segue no AuditCleanupService.
 * Só remove registros encerrados (sessões revogadas/expiradas, convites
 * aceitos/revogados/expirados, tokens usados/expirados...).
 */
@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    void this.purge();
    setInterval(() => void this.purge(), PURGE_INTERVAL_MS);
  }

  getPolicy(): RetentionPolicy {
    return retentionPolicy();
  }

  async purge(now = new Date()): Promise<Record<string, number>> {
    const policy = retentionPolicy();
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
    try {
      const [
        webhookEvents,
        sessions,
        passwordTokens,
        mfaChallenges,
        invitations,
        dataExports,
        backups,
      ] = await Promise.all([
        this.prisma.webhookEvent.deleteMany({
          where: { processedAt: { lt: before(policy.webhookEvents) } },
        }),
        this.prisma.userSession.deleteMany({
          where: {
            OR: [
              { revokedAt: { lt: before(policy.sessions) } },
              { expiresAt: { lt: before(policy.sessions) } },
            ],
          },
        }),
        this.prisma.passwordResetToken.deleteMany({
          where: {
            OR: [
              { usedAt: { lt: before(policy.passwordTokens) } },
              { expiresAt: { lt: before(policy.passwordTokens) } },
            ],
          },
        }),
        this.prisma.mfaChallenge.deleteMany({
          where: {
            OR: [
              { consumedAt: { lt: before(policy.mfaChallenges) } },
              { expiresAt: { lt: before(policy.mfaChallenges) } },
            ],
          },
        }),
        this.prisma.tenantInvitation.deleteMany({
          where: {
            OR: [
              { acceptedAt: { lt: before(policy.invitations) } },
              { revokedAt: { lt: before(policy.invitations) } },
              { expiresAt: { lt: before(policy.invitations) } },
            ],
          },
        }),
        this.prisma.dataExport.deleteMany({
          where: {
            status: { in: ['EXPIRED', 'FAILED'] },
            createdAt: { lt: before(policy.dataExports) },
          },
        }),
        this.prisma.tenantBackup.deleteMany({
          where: { expiresAt: { lt: before(policy.backups) } },
        }),
      ]);
      const counts = {
        webhookEvents: webhookEvents.count,
        sessions: sessions.count,
        passwordTokens: passwordTokens.count,
        mfaChallenges: mfaChallenges.count,
        invitations: invitations.count,
        dataExports: dataExports.count,
        backups: backups.count,
      };
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total > 0) {
        this.logger.log(`Retention purge removed ${total} record(s)`);
        await this.audit.record({
          action: 'compliance.retention_purge',
          resourceType: 'RetentionPolicy',
          changes: { policy, removed: counts },
        });
      }
      return counts;
    } catch (err) {
      this.logger.warn(`Retention purge failed: ${(err as Error).message}`);
      return {};
    }
  }
}

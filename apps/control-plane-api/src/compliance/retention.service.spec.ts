import { ROLES_KEY } from '../auth/roles.decorator';
import { ComplianceController } from './compliance.controller';
import { RetentionService, retentionPolicy } from './retention.service';

const DAY = 24 * 60 * 60 * 1000;

describe('retentionPolicy', () => {
  it('uses safe defaults and accepts positive overrides per data type', () => {
    expect(retentionPolicy({})).toEqual({
      webhookEvents: 90,
      sessions: 30,
      passwordTokens: 7,
      mfaChallenges: 1,
      invitations: 90,
      dataExports: 30,
      backups: 7,
      auditLogs: 90,
    });
    expect(
      retentionPolicy({
        RETENTION_SESSIONS_DAYS: '14',
        RETENTION_INVITATIONS_DAYS: '0',
        AUDIT_RETENTION_DAYS: '365',
        RETENTION_WEBHOOK_EVENTS_DAYS: 'abc',
      }),
    ).toMatchObject({
      sessions: 14,
      invitations: 90,
      auditLogs: 365,
      webhookEvents: 90,
    });
  });
});

describe('RetentionService.purge', () => {
  const originalEnv = { ...process.env };
  const now = new Date('2026-10-04T00:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: RetentionService;

  const model = (count: number) => ({
    deleteMany: jest.fn().mockResolvedValue({ count }),
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    prisma = {
      webhookEvent: model(3),
      userSession: model(5),
      passwordResetToken: model(2),
      mfaChallenge: model(0),
      tenantInvitation: model(1),
      dataExport: model(0),
      tenantBackup: model(4),
    };
    audit = { record: jest.fn() };
    service = new RetentionService(prisma, audit as any);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('removes only finished records past each retention window and audits the counts', async () => {
    const counts = await service.purge(now);

    expect(prisma.webhookEvent.deleteMany).toHaveBeenCalledWith({
      where: { processedAt: { lt: daysAgo(90) } },
    });
    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { revokedAt: { lt: daysAgo(30) } },
          { expiresAt: { lt: daysAgo(30) } },
        ],
      },
    });
    expect(prisma.tenantInvitation.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { acceptedAt: { lt: daysAgo(90) } },
          { revokedAt: { lt: daysAgo(90) } },
          { expiresAt: { lt: daysAgo(90) } },
        ],
      },
    });
    // Exportações prontas nunca são apagadas aqui (só vencidas/falhas).
    expect(prisma.dataExport.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['EXPIRED', 'FAILED'] },
        createdAt: { lt: daysAgo(30) },
      },
    });

    expect(counts).toEqual({
      webhookEvents: 3,
      sessions: 5,
      passwordTokens: 2,
      mfaChallenges: 0,
      invitations: 1,
      dataExports: 0,
      backups: 4,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'compliance.retention_purge',
        changes: expect.objectContaining({ removed: counts }),
      }),
    );
  });

  it('honours the configured windows', async () => {
    process.env.RETENTION_SESSIONS_DAYS = '7';
    await service.purge(now);
    expect(prisma.userSession.deleteMany.mock.calls[0][0].where.OR[0]).toEqual({
      revokedAt: { lt: daysAgo(7) },
    });
  });

  it('does not audit an empty run and never throws', async () => {
    for (const key of Object.keys(prisma)) prisma[key] = model(0);
    await service.purge(now);
    expect(audit.record).not.toHaveBeenCalled();

    prisma.webhookEvent.deleteMany.mockRejectedValue(new Error('db down'));
    await expect(service.purge(now)).resolves.toEqual({});
  });

  it('exposes the policy to platform admins only', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        (ComplianceController.prototype as any).retentionPolicy,
      ),
    ).toEqual(['PLATFORM_ADMIN']);
  });
});

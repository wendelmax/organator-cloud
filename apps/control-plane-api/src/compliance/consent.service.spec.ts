import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import { MailService } from '../mail/mail.service';
import { ComplianceController } from './compliance.controller';
import { ConsentService, documentVersions } from './consent.service';

describe('ConsentService', () => {
  const originalEnv = { ...process.env };
  const subject = { userId: 'u1', email: 'o@acme.com' };
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: ConsentService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TERMS_VERSION: '2026-10',
      PRIVACY_POLICY_VERSION: '2026-11',
    };
    prisma = {
      consent: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      dataExport: { findMany: jest.fn().mockResolvedValue([]) },
    };
    audit = { record: jest.fn() };
    service = new ConsentService(prisma, audit as any);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads the document versions from the environment', () => {
    expect(documentVersions()).toEqual({
      terms: '2026-10',
      privacy: '2026-11',
    });
    expect(documentVersions({})).toEqual({
      terms: '2026-10',
      privacy: '2026-10',
    });
  });

  describe('status', () => {
    it('asks for terms and privacy until the current versions are accepted', async () => {
      prisma.consent.findMany.mockResolvedValue([
        { purpose: 'terms', version: '2026-10', grantedAt: new Date() },
        // Política aceita numa versão anterior: pede de novo.
        { purpose: 'privacy', version: '2026-01', grantedAt: new Date() },
        { purpose: 'marketing', version: '2026-01', grantedAt: new Date() },
      ]);

      const status = await service.status(subject);

      expect(status.required).toEqual(['privacy']);
      expect(status.preferences).toEqual({ marketing: true, analytics: false });
      expect(status.versions).toEqual({ terms: '2026-10', privacy: '2026-11' });
      expect(prisma.consent.findMany.mock.calls[0][0].where).toEqual({
        userId: 'u1',
        revokedAt: null,
      });
    });

    it('is not available to API keys', async () => {
      await expect(
        service.status({ userId: 'u1', apiKeyAuth: true }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('grants the current version, closing older ones, and audits with IP and user agent', async () => {
      await service.update(
        subject,
        { purpose: 'privacy', granted: true },
        { ip: '10.0.0.1', userAgent: 'jest' },
      );

      expect(prisma.consent.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', purpose: 'privacy', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.consent.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          purpose: 'privacy',
          version: '2026-11',
          ip: '10.0.0.1',
          userAgent: 'jest',
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'privacy.consent_granted',
          changes: { purpose: 'privacy', version: '2026-11' },
        }),
      );
    });

    it('does not duplicate a consent already given for the current version', async () => {
      prisma.consent.findFirst.mockResolvedValue({ id: 'c1' });
      await service.update(subject, { purpose: 'terms', granted: true });
      expect(prisma.consent.create).not.toHaveBeenCalled();
    });

    it('revokes an optional purpose immediately', async () => {
      await service.update(subject, { purpose: 'marketing', granted: false });
      expect(prisma.consent.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', purpose: 'marketing', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'privacy.consent_revoked' }),
      );
    });

    it.each([
      [{ purpose: 'terms', granted: false }],
      [{ purpose: 'privacy', granted: false }],
      [{ purpose: 'tracking', granted: true }],
      [{ purpose: 'marketing' }],
    ])('rejects %j', async (input) => {
      await expect(service.update(subject, input as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.consent.updateMany).not.toHaveBeenCalled();
    });
  });

  it('builds the compliance view of a subject for the platform admin', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'o@acme.com' });
    prisma.consent.findMany.mockResolvedValue([{ purpose: 'terms' }]);
    await expect(service.subjectSummary('u1')).resolves.toMatchObject({
      user: { id: 'u1' },
      consents: [{ purpose: 'terms' }],
      exports: [],
    });

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.subjectSummary('nobody')).rejects.toThrow(
      NotFoundException,
    );
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        (ComplianceController.prototype as any).subjectSummary,
      ),
    ).toEqual(['PLATFORM_ADMIN']);
  });
});

describe('MailService — consent-gated messages', () => {
  const message = { to: 'o@acme.com', subject: 'Novidades', text: 'oi' };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('skips a message that requires consent the subject revoked', async () => {
    const prisma: any = {
      consent: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const mail = new MailService(prisma);

    await expect(
      mail.send(message, {
        requiresConsent: { userId: 'u1', purpose: 'marketing' },
      }),
    ).resolves.toBe(false);
    expect(prisma.consent.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', purpose: 'marketing', revokedAt: null },
      select: { id: true },
    });
  });

  it('transactional messages do not depend on consent', async () => {
    const prisma: any = { consent: { findFirst: jest.fn() } };
    await new MailService(prisma).send(message);
    expect(prisma.consent.findFirst).not.toHaveBeenCalled();
  });
});

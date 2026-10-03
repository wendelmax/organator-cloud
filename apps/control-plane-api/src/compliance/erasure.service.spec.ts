import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import { ComplianceController } from './compliance.controller';
import { ErasureService, subjectHashOf } from './erasure.service';

describe('ErasureService — right to be forgotten', () => {
  let user: any;
  let prisma: any;
  let tx: any;
  let audit: { record: jest.Mock };
  let service: ErasureService;

  beforeEach(async () => {
    user = {
      id: 'u1',
      email: 'Maria@Acme.com',
      role: 'MEMBER',
      tenantId: 't1',
      authProvider: 'credentials',
      password: await bcrypt.hash('Secret-123', 4),
    };
    tx = {
      auditLog: { updateMany: jest.fn().mockResolvedValue({ count: 4 }) },
      $executeRaw: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1),
      tenantInvitation: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      apiKey: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      user: { delete: jest.fn() },
    };
    prisma = {
      user: {
        findUnique: jest.fn(async () => user),
        count: jest.fn().mockResolvedValue(1),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      erasureRecord: {
        create: jest.fn(({ data }) => Promise.resolve({ id: 'er-1', ...data })),
      },
      $transaction: jest.fn((fn: (t: any) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn() };
    service = new ErasureService(prisma, audit as any);
  });

  it('deletes the account, anonymizes what must stay and keeps a PII-free proof', async () => {
    const result = await service.eraseSelf(
      { userId: 'u1' },
      { password: 'Secret-123' },
    );

    expect(tx.auditLog.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ actorId: 'u1' }, { actorEmail: 'Maria@Acme.com' }] },
      data: { actorId: null, actorEmail: '[apagado]', ip: null },
    });
    // E-mail dentro das alterações de auditoria e dos payloads do Stripe.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.tenantInvitation.deleteMany).toHaveBeenCalledWith({
      where: { email: 'Maria@Acme.com' },
    });
    expect(tx.apiKey.updateMany).toHaveBeenCalledWith({
      where: { createdBy: 'u1' },
      data: { createdBy: null },
    });
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });

    const record = prisma.erasureRecord.create.mock.calls[0][0].data;
    expect(record.subjectHash).toBe(subjectHashOf('maria@acme.com'));
    expect(JSON.stringify(record)).not.toContain('Maria@Acme.com');
    expect(record).toMatchObject({
      requestedBy: null,
      reason: 'subject_request',
    });
    expect(record.summary).toMatchObject({
      account: 'deleted',
      auditEntriesAnonymized: 6,
      webhookPayloadsAnonymized: 1,
      invitationsDeleted: 1,
      apiKeysDetached: 3,
    });
    expect(result).toMatchObject({ erased: true, erasureId: 'er-1' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'compliance.subject_erased',
        resourceId: 'er-1',
      }),
    );
  });

  it('requires the password (or the e-mail for SSO accounts) before erasing', async () => {
    await expect(
      service.eraseSelf({ userId: 'u1' }, { password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);

    user.authProvider = 'oidc';
    await expect(
      service.eraseSelf({ userId: 'u1' }, { email: 'other@acme.com' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.eraseSelf({ userId: 'u1' }, { email: ' maria@acme.com ' }),
    ).resolves.toMatchObject({ erased: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses to orphan an organization: the last OWNER must transfer it first', async () => {
    user.role = 'OWNER';
    prisma.user.count.mockResolvedValue(0);
    await expect(
      service.eraseSelf({ userId: 'u1' }, { password: 'Secret-123' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('also checks organizations owned through a membership', async () => {
    prisma.tenantMembership.findMany.mockResolvedValue([
      { tenantId: 't-other' },
    ]);
    prisma.user.count.mockResolvedValue(0);
    await expect(service.eraseByAdmin('u1', 'admin-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('records the admin who handled the request', async () => {
    await service.eraseByAdmin('u1', 'admin-1');
    expect(prisma.erasureRecord.create.mock.calls[0][0].data).toMatchObject({
      requestedBy: 'admin-1',
      reason: 'admin_request',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'admin-1' }),
    );
  });

  it('does not erase platform admins, API keys or unknown users', async () => {
    await expect(
      service.eraseSelf({ userId: 'u1', apiKeyAuth: true }, {}),
    ).rejects.toThrow(ForbiddenException);

    user.role = 'PLATFORM_ADMIN';
    await expect(service.eraseByAdmin('u1', 'admin-1')).rejects.toThrow(
      ForbiddenException,
    );

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.eraseByAdmin('nobody', 'admin-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('only platform admins erase other users', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        (ComplianceController.prototype as any).eraseUser,
      ),
    ).toEqual(['PLATFORM_ADMIN']);
  });
});

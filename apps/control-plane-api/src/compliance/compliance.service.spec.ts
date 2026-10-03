import {
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@organator/core-models';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

describe('ComplianceService — data subject export', () => {
  const subject = { userId: 'u1', email: 'owner@acme.com' };
  let prisma: any;
  let audit: { record: jest.Mock };
  let queue: { add: jest.Mock };
  let service: ComplianceService;

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
      dataExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'e1', status: 'PENDING' }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    audit = { record: jest.fn() };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new ComplianceService(prisma, audit as any, queue as any);
  });

  describe('requestExport', () => {
    it('creates the request, queues the job and audits it', async () => {
      await expect(service.requestExport(subject, '10.0.0.1')).resolves.toEqual(
        {
          id: 'e1',
          status: 'PENDING',
        },
      );
      expect(prisma.dataExport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { userId: 'u1', scope: 'USER', tenantId: null },
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'generate-data-export',
        { exportId: 'e1' },
        { jobId: 'data-export__e1' },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'compliance.export_requested',
          actorId: 'u1',
          resourceId: 'e1',
          ip: '10.0.0.1',
        }),
      );
    });

    it('returns the open request instead of creating another within a day', async () => {
      prisma.dataExport.findFirst.mockResolvedValue({
        id: 'e0',
        status: 'READY',
      });
      await expect(service.requestExport(subject)).resolves.toEqual({
        id: 'e0',
        status: 'READY',
      });
      expect(prisma.dataExport.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('marks the request FAILED when it cannot be queued', async () => {
      queue.add.mockRejectedValue(new Error('Connection is closed'));
      await expect(service.requestExport(subject)).rejects.toThrow(
        'Connection is closed',
      );
      expect(prisma.dataExport.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'FAILED', error: 'Connection is closed' },
      });
    });

    it('is not available to API keys', async () => {
      await expect(
        service.requestExport({ userId: 'u1', apiKeyAuth: true }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.dataExport.create).not.toHaveBeenCalled();
    });
  });

  describe('requestTenantExport (platform admin)', () => {
    const admin = { userId: 'admin-1', email: 'ops@organator.app' };

    it('creates a TENANT request for the requester and audits it on the tenant', async () => {
      await service.requestTenantExport(admin, 't1', '10.0.0.9');

      expect(prisma.dataExport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { userId: 'admin-1', scope: 'TENANT', tenantId: 't1' },
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'generate-data-export',
        { exportId: 'e1' },
        { jobId: 'data-export__e1' },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'compliance.tenant_export_requested',
          resourceType: 'Tenant',
          resourceId: 't1',
          actorId: 'admin-1',
        }),
      );
    });

    it('keeps the 24h window per tenant', async () => {
      await service.requestTenantExport(admin, 't1');
      expect(prisma.dataExport.findFirst.mock.calls[0][0].where).toMatchObject({
        userId: 'admin-1',
        scope: 'TENANT',
        tenantId: 't1',
      });
    });

    it('answers 404 for an unknown tenant without creating anything', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.requestTenantExport(admin, 'nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.dataExport.create).not.toHaveBeenCalled();
    });
  });

  it('only lets the platform admin request a tenant export', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        (ComplianceController.prototype as any).requestTenantExport,
      ),
    ).toEqual(['PLATFORM_ADMIN']);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        (ComplianceController.prototype as any).requestTenantExport,
      ),
    ).toEqual([RolesGuard]);
  });

  it("lists only the subject's own exports, without content", async () => {
    await service.listExports(subject);
    const args = prisma.dataExport.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'u1' });
    expect(args.select.content).toBeUndefined();
  });

  describe('download', () => {
    const ready = {
      id: 'e1',
      userId: 'u1',
      status: 'READY',
      content: { format: 'organator.user-export.v1' },
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('returns the document to its owner and audits the download', async () => {
      prisma.dataExport.findFirst.mockResolvedValue(ready);
      await expect(service.download(subject, 'e1')).resolves.toEqual(
        ready.content,
      );
      expect(prisma.dataExport.findFirst).toHaveBeenCalledWith({
        where: { id: 'e1', userId: 'u1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'compliance.export_downloaded' }),
      );
    });

    it("answers 404 for another user's export (scoped by owner)", async () => {
      await expect(service.download({ userId: 'u2' }, 'e1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('answers 410 once the file expired and 404 while it is not ready', async () => {
      prisma.dataExport.findFirst.mockResolvedValueOnce({
        ...ready,
        expiresAt: new Date(Date.now() - 1),
      });
      await expect(service.download(subject, 'e1')).rejects.toThrow(
        GoneException,
      );

      prisma.dataExport.findFirst.mockResolvedValueOnce({
        ...ready,
        status: 'PENDING',
        content: null,
        expiresAt: null,
      });
      await expect(service.download(subject, 'e1')).rejects.toThrow(
        NotFoundException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  it('erases the content of expired exports', async () => {
    const now = new Date('2026-10-10T00:00:00Z');
    await expect(service.purgeExpired(now)).resolves.toBe(2);
    expect(prisma.dataExport.updateMany).toHaveBeenCalledWith({
      where: { status: 'READY', expiresAt: { lt: now } },
      data: { status: 'EXPIRED', content: Prisma.DbNull },
    });
  });

  it('requires an authenticated user on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ComplianceController)).toEqual([
      JwtAuthGuard,
    ]);
  });
});

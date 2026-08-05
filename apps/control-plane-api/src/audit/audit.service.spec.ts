import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      auditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AuditService>(AuditService);
    jest.clearAllMocks();
  });

  describe('record', () => {
    it('persists an entry with all fields', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'a1' });

      await service.record({
        actorId: 'u1',
        actorEmail: 'admin@organator.app',
        action: 'tenant.member.added',
        resourceType: 'TenantMember',
        resourceId: 'm1',
        changes: { email: 'new@organator.app', role: 'MEMBER' },
        ip: '127.0.0.1',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'u1',
          actorEmail: 'admin@organator.app',
          action: 'tenant.member.added',
          resourceType: 'TenantMember',
          resourceId: 'm1',
          changes: { email: 'new@organator.app', role: 'MEMBER' },
          ip: '127.0.0.1',
        },
      });
    });

    it('normalizes missing optional fields to null/empty', async () => {
      prisma.auditLog.create.mockResolvedValue({});

      await service.record({
        action: 'auth.login_failed',
        resourceType: 'Auth',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: null,
          actorEmail: null,
          action: 'auth.login_failed',
          resourceType: 'Auth',
          resourceId: null,
          changes: {},
          ip: null,
        },
      });
    });

    it('never throws when persistence fails (best-effort)', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.record({ action: 'x', resourceType: 'X' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('applies filters and pagination defaults', async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: 'a1' }]);
      prisma.auditLog.count.mockResolvedValue(42);

      const result = await service.findAll({ action: 'tenant.created' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { action: 'tenant.created' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 25,
      });
      expect(prisma.auditLog.count).toHaveBeenCalledWith({
        where: { action: 'tenant.created' },
      });
      expect(result).toEqual({
        items: [{ id: 'a1' }],
        total: 42,
        page: 1,
        limit: 25,
        pages: 2,
      });
    });

    it('builds actorEmail as case-insensitive contains', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ actorEmail: 'Admin' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { actorEmail: { contains: 'Admin', mode: 'insensitive' } },
        }),
      );
    });

    it('builds date range from/to', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.findAll({ from: '2026-01-01', to: '2026-02-01' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-02-01'),
            },
          },
        }),
      );
    });

    it('clamps page >= 1 and limit <= 100', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      const result = await service.findAll({ page: 0, limit: 999 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
      expect(result.page).toBe(1);
      expect(result.limit).toBe(100);
    });
  });

  describe('cleanup', () => {
    it('deletes only entries older than the retention cutoff', async () => {
      prisma.auditLog.deleteMany.mockResolvedValue({ count: 7 });
      const before = Date.now();

      const deleted = await service.cleanup(90);

      expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(1);
      const cutoff: Date =
        prisma.auditLog.deleteMany.mock.calls[0][0].where.createdAt.lt;
      expect(cutoff.getTime()).toBeLessThanOrEqual(before);
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(
        before - 90 * 24 * 3600 * 1000,
      );
      expect(deleted).toBe(7);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

describe('TenantsService', () => {
  let service: TenantsService;

  const mockEntitlements = {
    bust: jest.fn(),
  };

  const mockAudit = {
    record: jest.fn(),
  };

  const mockLifecycle = {
    markSuspended: jest.fn(),
    restoreActive: jest.fn(),
    markOffboarding: jest.fn(),
  };

  const mockPrisma = {
    tenant: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    billingPlan: {
      findUnique: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    microservice: {
      count: jest.fn(),
    },
    deployment: {
      count: jest.fn(),
    },
    apiDoc: {
      count: jest.fn(),
    },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EntitlementsService, useValue: mockEntitlements },
        { provide: AuditService, useValue: mockAudit },
        { provide: TenantLifecycleService, useValue: mockLifecycle },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updateTenant', () => {
    it('should update name and slug', async () => {
      mockPrisma.tenant.findUnique
        .mockResolvedValueOnce({ id: 'tenant-1' })
        .mockResolvedValueOnce(null);
      mockPrisma.tenant.update.mockResolvedValue({
        id: 'tenant-1',
        name: 'Acme 2',
        slug: 'acme-2',
      });

      const result = await service.updateTenant('tenant-1', {
        name: 'Acme 2',
        slug: 'Acme 2',
      });

      expect(result).toEqual({
        id: 'tenant-1',
        name: 'Acme 2',
        slug: 'acme-2',
      });
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { name: 'Acme 2', slug: 'acme-2' },
      });
    });

    it('should throw NotFoundException if tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.updateTenant('missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if slug is already used by another tenant', async () => {
      mockPrisma.tenant.findUnique
        .mockResolvedValueOnce({ id: 'tenant-1' })
        .mockResolvedValueOnce({ id: 'tenant-2', slug: 'acme' });

      await expect(
        service.updateTenant('tenant-1', { slug: 'acme' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException for invalid slug', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        slug: 'acme',
      });

      await expect(
        service.updateTenant('tenant-1', { slug: '!!!' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('changePlan', () => {
    it('should update tenant plan when billing plan is registered', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue({ slug: 'pro' });
      mockPrisma.tenant.update.mockResolvedValue({
        id: 'tenant-1',
        plan: 'pro',
      });

      const result = await service.changePlan('tenant-1', 'Pro');

      expect(result).toEqual({
        id: 'tenant-1',
        plan: 'pro',
        migration: {
          jobId: undefined,
          status: 'QUEUED',
          idempotencyKey: 'plan-migration:tenant-1:pro',
        },
      });
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: { plan: 'pro' },
      });
    });

    it('should throw BadRequestException for invalid plan', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });

      await expect(service.changePlan('tenant-1', 'mega')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if billing plan not registered', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue(null);

      await expect(service.changePlan('tenant-1', 'pro')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('tenant status lifecycle (via state machine)', () => {
    it('should suspend a tenant through the lifecycle state machine', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        status: 'active',
        state: 'active',
      });
      mockLifecycle.markSuspended.mockResolvedValue({
        id: 'tenant-1',
        status: 'suspended',
        state: 'suspended',
      });

      const result = await service.suspendTenant('tenant-1');
      expect(result).toEqual({
        id: 'tenant-1',
        status: 'suspended',
        state: 'suspended',
      });
      expect(mockLifecycle.markSuspended).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ reason: 'manual.admin' }),
      );
    });

    it('should reactivate a tenant through the lifecycle state machine', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        status: 'suspended',
        state: 'suspended',
      });
      mockLifecycle.restoreActive.mockResolvedValue({
        id: 'tenant-1',
        status: 'active',
        state: 'active',
      });

      const result = await service.reactivateTenant('tenant-1');
      expect(result.status).toBe('active');
      expect(result.state).toBe('active');
      expect(mockLifecycle.restoreActive).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ reason: 'manual.admin' }),
      );
    });

    it('should archive a tenant as offboarding through the lifecycle', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        status: 'active',
        state: 'active',
      });
      mockLifecycle.markOffboarding.mockResolvedValue({
        id: 'tenant-1',
        status: 'archived',
        state: 'offboarding',
      });

      const result = await service.archiveTenant('tenant-1');
      expect(result.status).toBe('archived');
      expect(result.state).toBe('offboarding');
      expect(mockLifecycle.markOffboarding).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ reason: 'manual.admin' }),
      );
    });

    it('should throw NotFoundException if tenant does not exist', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.suspendTenant('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('transferOwnership', () => {
    it('should demote owners and promote new owner', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
      });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-2',
        tenantId: 'tenant-1',
        role: 'ADMIN',
      });
      mockPrisma.$transaction.mockResolvedValue([
        { count: 2 },
        { id: 'user-2', role: 'OWNER' },
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-2',
        email: 'new@example.com',
        name: 'New Owner',
        role: 'OWNER',
        createdAt: new Date(),
      });

      const result = await service.transferOwnership('tenant-1', 'user-2');

      expect(result.role).toBe('OWNER');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', role: 'OWNER' },
        data: { role: 'ADMIN' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { role: 'OWNER' },
      });
    });

    it('should throw BadRequestException if target user is not in the same tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.transferOwnership('tenant-1', 'user-999'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTenantMetrics', () => {
    it('should return counts and estimated spend based on plan', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'pro',
      });
      mockPrisma.microservice.count.mockResolvedValue(5);
      mockPrisma.deployment.count.mockResolvedValue(12);
      mockPrisma.apiDoc.count.mockResolvedValue(3);
      mockPrisma.user.count.mockResolvedValue(4);
      mockPrisma.billingPlan.findUnique.mockResolvedValue({ price: 4900 });

      const result = await service.getTenantMetrics('tenant-1');

      expect(result).toEqual({
        microservices: 5,
        deployments: 12,
        apiDocs: 3,
        users: 4,
        estimatedSpend: 4900,
      });
    });
  });

  describe('getTenantQuotaUsage', () => {
    it('should return plan limits and current usage', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        plan: 'free',
      });
      mockPrisma.billingPlan.findUnique.mockResolvedValue({
        slug: 'free',
        quotas: { MICROSERVICE: 2, DEPLOYMENT: 5 },
      });
      mockPrisma.microservice.count.mockResolvedValue(1);
      mockPrisma.deployment.count.mockResolvedValue(2);
      mockPrisma.apiDoc.count.mockResolvedValue(1);
      mockPrisma.user.count.mockResolvedValue(3);

      const result = await service.getTenantQuotaUsage('tenant-1');

      expect(result).toEqual({
        plan: 'free',
        limits: { MICROSERVICE: 2, DEPLOYMENT: 5 },
        usage: {
          MICROSERVICE: 1,
          DEPLOYMENT: 2,
          APIS: 1,
          SEATS: 3,
        },
      });
    });
  });

  describe('getMembers', () => {
    it('should return list of members for tenant', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          email: 'user1@example.com',
          name: 'User 1',
          role: 'ADMIN',
          createdAt: new Date(),
        },
      ];
      mockPrisma.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.getMembers('tenant-123');
      expect(result).toEqual(mockUsers);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-123' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      });
    });
  });

  describe('addMember', () => {
    it('should hash password and create a user', async () => {
      const newUser = {
        id: 'user-2',
        email: 'user2@example.com',
        name: 'User 2',
        role: 'MEMBER',
        createdAt: new Date(),
      };
      mockPrisma.user.create.mockResolvedValue(newUser);

      const result = await service.addMember(
        'tenant-123',
        'user2@example.com',
        'User 2',
        'MEMBER',
        'secret123',
      );

      expect(result).toEqual(newUser);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-123',
          email: 'user2@example.com',
          name: 'User 2',
          role: 'MEMBER',
          password: expect.any(String),
        }),
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      });
    });

    it('records an audit entry with actor info', async () => {
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-2',
        email: 'user2@example.com',
        role: 'MEMBER',
        createdAt: new Date(),
      });

      await service.addMember(
        'tenant-123',
        'user2@example.com',
        undefined,
        'MEMBER',
        undefined,
        {
          actorId: 'admin-1',
          actorEmail: 'admin@organator.app',
          ip: '127.0.0.1',
        },
      );

      expect(mockAudit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        actorEmail: 'admin@organator.app',
        ip: '127.0.0.1',
        action: 'tenant.member.added',
        resourceType: 'TenantMember',
        resourceId: 'user-2',
        changes: {
          tenantId: 'tenant-123',
          email: 'user2@example.com',
          role: 'MEMBER',
        },
      });
    });
  });

  describe('updateMemberRole', () => {
    it('should update member role if member exists in tenant', async () => {
      const existingUser = {
        id: 'user-1',
        tenantId: 'tenant-123',
        role: 'MEMBER',
      };
      const updatedUser = {
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User 1',
        role: 'ADMIN',
        createdAt: new Date(),
      };
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateMemberRole(
        'tenant-123',
        'user-1',
        'ADMIN',
      );
      expect(result).toEqual(updatedUser);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: 'ADMIN' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      });
    });

    it('records an audit entry with from/to role', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-123',
        role: 'MEMBER',
        email: 'user1@example.com',
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'user1@example.com',
        role: 'ADMIN',
        createdAt: new Date(),
      });

      await service.updateMemberRole('tenant-123', 'user-1', 'ADMIN', {
        actorId: 'admin-1',
        actorEmail: 'admin@organator.app',
        ip: '127.0.0.1',
      });

      expect(mockAudit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        actorEmail: 'admin@organator.app',
        ip: '127.0.0.1',
        action: 'tenant.member.role_changed',
        resourceType: 'TenantMember',
        resourceId: 'user-1',
        changes: {
          tenantId: 'tenant-123',
          email: 'user1@example.com',
          from: 'MEMBER',
          to: 'ADMIN',
        },
      });
    });

    it('should throw NotFoundException if member not found in tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.updateMemberRole('tenant-123', 'invalid-user', 'ADMIN'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if trying to assign PLATFORM_ADMIN', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-123',
        role: 'MEMBER',
      });

      await expect(
        service.updateMemberRole('tenant-123', 'user-1', 'PLATFORM_ADMIN'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeMember', () => {
    it('should delete member if exists in tenant', async () => {
      const existingUser = {
        id: 'user-1',
        tenantId: 'tenant-123',
        role: 'MEMBER',
      };
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.user.delete.mockResolvedValue(existingUser);

      const result = await service.removeMember('tenant-123', 'user-1');
      expect(result).toEqual(existingUser);
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('records an audit entry when removing a member', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-123',
        role: 'MEMBER',
        email: 'user1@example.com',
      });
      mockPrisma.user.count.mockResolvedValue(2);
      mockPrisma.user.delete.mockResolvedValue({});

      await service.removeMember('tenant-123', 'user-1', {
        actorId: 'admin-1',
        actorEmail: 'admin@organator.app',
        ip: '127.0.0.1',
      });

      expect(mockAudit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        actorEmail: 'admin@organator.app',
        ip: '127.0.0.1',
        action: 'tenant.member.removed',
        resourceType: 'TenantMember',
        resourceId: 'user-1',
        changes: {
          tenantId: 'tenant-123',
          email: 'user1@example.com',
          role: 'MEMBER',
        },
      });
    });

    it('should throw NotFoundException if member not found in tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMember('tenant-123', 'invalid-user'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when removing the only OWNER', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-123',
        role: 'OWNER',
      });
      mockPrisma.user.count.mockResolvedValue(1);

      await expect(
        service.removeMember('tenant-123', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

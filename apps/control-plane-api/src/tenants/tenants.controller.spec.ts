import { Test, TestingModule } from '@nestjs/testing';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { BadRequestException } from '@nestjs/common';

describe('TenantsController', () => {
  let controller: TenantsController;

  const mockEntitlementsService = {
    resolve: jest.fn(),
  };

  const mockTenantsService = {
    getTenants: jest.fn(),
    getTenant: jest.fn(),
    getTenantMetrics: jest.fn(),
    getTenantQuotaUsage: jest.fn(),
    createTenant: jest.fn(),
    updateTenant: jest.fn(),
    changePlan: jest.fn(),
    suspendTenant: jest.fn(),
    reactivateTenant: jest.fn(),
    archiveTenant: jest.fn(),
    transferOwnership: jest.fn(),
    getMembers: jest.fn(),
    addMember: jest.fn(),
    updateMemberRole: jest.fn(),
    removeMember: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        { provide: TenantsService, useValue: mockTenantsService },
        { provide: EntitlementsService, useValue: mockEntitlementsService },
      ],
    }).compile();

    controller = module.get<TenantsController>(TenantsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should call service.getTenants', async () => {
      mockTenantsService.getTenants.mockResolvedValue([{ id: 't1' }]);
      const result = await controller.findAll();
      expect(result).toEqual([{ id: 't1' }]);
      expect(mockTenantsService.getTenants).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should call service.getTenant with id', async () => {
      mockTenantsService.getTenant.mockResolvedValue({ id: 't1' });
      const result = await controller.findOne('t1');
      expect(result).toEqual({ id: 't1' });
      expect(mockTenantsService.getTenant).toHaveBeenCalledWith('t1');
    });
  });

  describe('create', () => {
    it('should call service.createTenant', async () => {
      mockTenantsService.createTenant.mockResolvedValue({ id: 't1' });
      const result = await controller.create({
        name: 'Acme',
        plan: 'free',
        adminEmail: 'a@b.com',
      });
      expect(result).toEqual({ id: 't1' });
      expect(mockTenantsService.createTenant).toHaveBeenCalledWith(
        'Acme',
        'free',
        'a@b.com',
      );
    });

    it('should throw BadRequestException when name missing', async () => {
      await expect(
        controller.create({ name: '', plan: 'free', adminEmail: 'a@b.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should call service.updateTenant', async () => {
      mockTenantsService.updateTenant.mockResolvedValue({ id: 't1' });
      const result = await controller.update('t1', { name: 'Acme 2' });
      expect(result).toEqual({ id: 't1' });
      expect(mockTenantsService.updateTenant).toHaveBeenCalledWith('t1', {
        name: 'Acme 2',
      });
    });
  });

  describe('changePlan', () => {
    it('should call service.changePlan', async () => {
      mockTenantsService.changePlan.mockResolvedValue({
        id: 't1',
        plan: 'pro',
      });
      const result = await controller.changePlan(
        't1',
        { plan: 'pro' },
        { user: { userId: 'admin-1' } },
      );
      expect(result).toEqual({ id: 't1', plan: 'pro' });
      expect(mockTenantsService.changePlan).toHaveBeenCalledWith(
        't1',
        'pro',
        'admin-1',
      );
    });

    it('should throw BadRequestException when plan missing', async () => {
      await expect(controller.changePlan('t1', { plan: '' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('status endpoints', () => {
    it('should suspend a tenant', async () => {
      mockTenantsService.suspendTenant.mockResolvedValue({
        status: 'suspended',
      });
      const result = await controller.suspendTenant('t1');
      expect(mockTenantsService.suspendTenant).toHaveBeenCalledWith('t1');
      expect(result).toEqual({ status: 'suspended' });
    });

    it('should reactivate a tenant', async () => {
      mockTenantsService.reactivateTenant.mockResolvedValue({
        status: 'active',
      });
      const result = await controller.reactivateTenant('t1');
      expect(mockTenantsService.reactivateTenant).toHaveBeenCalledWith('t1');
      expect(result).toEqual({ status: 'active' });
    });

    it('should archive a tenant', async () => {
      mockTenantsService.archiveTenant.mockResolvedValue({
        status: 'archived',
      });
      const result = await controller.archiveTenant('t1');
      expect(mockTenantsService.archiveTenant).toHaveBeenCalledWith('t1');
      expect(result).toEqual({ status: 'archived' });
    });
  });

  describe('transferOwnership', () => {
    it('should call service.transferOwnership', async () => {
      mockTenantsService.transferOwnership.mockResolvedValue({ id: 'u2' });
      const result = await controller.transferOwnership('t1', {
        newOwnerId: 'u2',
      });
      expect(result).toEqual({ id: 'u2' });
      expect(mockTenantsService.transferOwnership).toHaveBeenCalledWith(
        't1',
        'u2',
      );
    });

    it('should throw BadRequestException when newOwnerId missing', async () => {
      await expect(
        controller.transferOwnership('t1', { newOwnerId: '' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('metrics endpoints', () => {
    it('should get tenant metrics', async () => {
      mockTenantsService.getTenantMetrics.mockResolvedValue({
        microservices: 1,
      });
      const result = await controller.getTenantMetrics('t1');
      expect(mockTenantsService.getTenantMetrics).toHaveBeenCalledWith('t1');
      expect(result).toEqual({ microservices: 1 });
    });

    it('should get quota usage', async () => {
      mockTenantsService.getTenantQuotaUsage.mockResolvedValue({
        plan: 'free',
      });
      const result = await controller.getTenantQuotaUsage('t1');
      expect(mockTenantsService.getTenantQuotaUsage).toHaveBeenCalledWith('t1');
      expect(result).toEqual({ plan: 'free' });
    });
  });

  describe('getMembers', () => {
    it('should call service.getMembers with authenticated tenantId', async () => {
      const mockReq = { user: { tenantId: 'tenant-123' } };
      const mockMembers = [{ id: 'user-1', email: 'test@example.com' }];
      mockTenantsService.getMembers.mockResolvedValue(mockMembers);

      const result = await controller.getMembers(mockReq);
      expect(result).toEqual(mockMembers);
      expect(mockTenantsService.getMembers).toHaveBeenCalledWith('tenant-123');
    });

    it('should throw BadRequestException if no tenantId', async () => {
      const mockReq = { user: {} };
      await expect(controller.getMembers(mockReq)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('addMember', () => {
    it('should call service.addMember with tenantId and details', async () => {
      const mockReq = {
        user: {
          tenantId: 'tenant-123',
          sub: 'admin-1',
          email: 'admin@organator.app',
        },
        ip: '127.0.0.1',
      };
      const body = {
        email: 'new@example.com',
        name: 'New User',
        role: 'ADMIN',
      };
      const createdMember = { id: 'user-2', email: 'new@example.com' };
      mockTenantsService.addMember.mockResolvedValue(createdMember);

      const result = await controller.addMember(mockReq, body);
      expect(result).toEqual(createdMember);
      expect(mockTenantsService.addMember).toHaveBeenCalledWith(
        'tenant-123',
        'new@example.com',
        'New User',
        'ADMIN',
        undefined,
        {
          actorId: 'admin-1',
          actorEmail: 'admin@organator.app',
          ip: '127.0.0.1',
        },
      );
    });

    it('should throw BadRequestException if email is missing', async () => {
      const mockReq = { user: { tenantId: 'tenant-123' } };
      await expect(
        controller.addMember(mockReq, { email: '' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateMemberRole', () => {
    it('should call service.updateMemberRole', async () => {
      const mockReq = {
        user: {
          tenantId: 'tenant-123',
          sub: 'admin-1',
          email: 'admin@organator.app',
        },
        ip: '127.0.0.1',
      };
      const updatedMember = { id: 'user-1', role: 'OWNER' };
      mockTenantsService.updateMemberRole.mockResolvedValue(updatedMember);

      const result = await controller.updateMemberRole(mockReq, 'user-1', {
        role: 'OWNER',
      });
      expect(result).toEqual(updatedMember);
      expect(mockTenantsService.updateMemberRole).toHaveBeenCalledWith(
        'tenant-123',
        'user-1',
        'OWNER',
        {
          actorId: 'admin-1',
          actorEmail: 'admin@organator.app',
          ip: '127.0.0.1',
        },
      );
    });
  });

  describe('removeMember', () => {
    it('should call service.removeMember', async () => {
      const mockReq = {
        user: {
          tenantId: 'tenant-123',
          sub: 'admin-1',
          email: 'admin@organator.app',
        },
        ip: '127.0.0.1',
      };
      mockTenantsService.removeMember.mockResolvedValue({ id: 'user-1' });

      const result = await controller.removeMember(mockReq, 'user-1');
      expect(result).toEqual({ id: 'user-1' });
      expect(mockTenantsService.removeMember).toHaveBeenCalledWith(
        'tenant-123',
        'user-1',
        {
          actorId: 'admin-1',
          actorEmail: 'admin@organator.app',
          ip: '127.0.0.1',
        },
      );
    });
  });

  describe('getTenantEntitlements', () => {
    it('should resolve entitlements for the tenant', async () => {
      const entitlements = {
        tenantId: 'tenant-123',
        plan: 'pro',
        quotas: { MICROSERVICE: 20 },
        features: { api_keys: true },
        limits: { MICROSERVICE: 'hard' },
        computedAt: new Date(),
      };
      mockEntitlementsService.resolve.mockResolvedValue(entitlements);

      const result = await controller.getTenantEntitlements('tenant-123');
      expect(result).toEqual(entitlements);
      expect(mockEntitlementsService.resolve).toHaveBeenCalledWith(
        'tenant-123',
      );
    });
  });
});

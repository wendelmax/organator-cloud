import { Test, TestingModule } from '@nestjs/testing';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { BadRequestException } from '@nestjs/common';

describe('TenantsController', () => {
  let controller: TenantsController;
  let service: TenantsService;

  const mockTenantsService = {
    getTenants: jest.fn(),
    createTenant: jest.fn(),
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
      ],
    }).compile();

    controller = module.get<TenantsController>(TenantsController);
    service = module.get<TenantsService>(TenantsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
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
      const mockReq = { user: { tenantId: 'tenant-123' } };
      const body = { email: 'new@example.com', name: 'New User', role: 'ADMIN' };
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
      const mockReq = { user: { tenantId: 'tenant-123' } };
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
      );
    });
  });

  describe('removeMember', () => {
    it('should call service.removeMember', async () => {
      const mockReq = { user: { tenantId: 'tenant-123' } };
      mockTenantsService.removeMember.mockResolvedValue({ id: 'user-1' });

      const result = await controller.removeMember(mockReq, 'user-1');
      expect(result).toEqual({ id: 'user-1' });
      expect(mockTenantsService.removeMember).toHaveBeenCalledWith(
        'tenant-123',
        'user-1',
      );
    });
  });
});

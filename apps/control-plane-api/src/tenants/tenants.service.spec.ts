import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: PrismaService;

  const mockPrisma = {
    tenant: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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

    it('should throw NotFoundException if member not found in tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.updateMemberRole('tenant-123', 'invalid-user', 'ADMIN'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeMember', () => {
    it('should delete member if exists in tenant', async () => {
      const existingUser = { id: 'user-1', tenantId: 'tenant-123' };
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.user.delete.mockResolvedValue(existingUser);

      const result = await service.removeMember('tenant-123', 'user-1');
      expect(result).toEqual(existingUser);
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should throw NotFoundException if member not found in tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMember('tenant-123', 'invalid-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

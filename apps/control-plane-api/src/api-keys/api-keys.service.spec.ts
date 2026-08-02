import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let prisma: any;

  const mockAudit = { record: jest.fn().mockResolvedValue(undefined) };

  const mockPrisma = () => ({
    apiKey: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    tenant: { findUnique: jest.fn() },
  });

  beforeEach(async () => {
    prisma = mockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('throws BadRequest without a name', async () => {
      await expect(service.create({ name: '  ' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('persists only the sha256 hash and returns token once', async () => {
      prisma.apiKey.create.mockResolvedValue({
        id: 'key-1',
        name: 'CI pipeline',
        hash: 'hash',
        prefix: 'sk_abcd',
        scopes: ['services:read'],
        tenantId: null,
        createdBy: null,
        expiresAt: null,
      });

      const result = await service.create({
        name: 'CI pipeline',
        scopes: ['services:read'],
      });

      expect(result.token).toMatch(/^sk_[0-9a-f]{64}$/);
      const saved = prisma.apiKey.create.mock.calls[0][0].data;
      expect(saved.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(saved.hash).not.toContain(result.token);
      expect(saved.scopes).toEqual(['services:read']);
      expect(result.apiKey).not.toHaveProperty('hash');
    });

    it('normalizes unknown/duplicate scopes', async () => {
      prisma.apiKey.create.mockResolvedValue({
        id: 'key-1',
        scopes: ['services:read'],
      });

      await service.create({
        name: 'k',
        scopes: ['services:read', 'unknown:scope', 'services:read'],
      });

      expect(prisma.apiKey.create.mock.calls[0][0].data.scopes).toEqual([
        'services:read',
      ]);
    });

    it('rejects create for a non-existent tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ name: 'k', tenantId: 'nope' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('audits api_key.created', async () => {
      prisma.apiKey.create.mockResolvedValue({
        id: 'key-1',
        name: 'k',
        scopes: [],
      });
      await service.create({ name: 'k', createdBy: 'u1' });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'api_key.created', actorId: 'u1' }),
      );
    });
  });

  describe('validate', () => {
    it('returns null for non sk_ tokens', async () => {
      await expect(service.validate('jwt-token')).resolves.toBeNull();
    });

    it('returns null when key not found', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);
      await expect(service.validate('sk_0000')).resolves.toBeNull();
    });

    it('returns null when expired', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        name: 'k',
        scopes: [],
        tenantId: null,
        expiresAt: new Date(Date.now() - 1000),
        tenant: null,
      });
      await expect(service.validate('sk_0000')).resolves.toBeNull();
    });

    it('returns null when tenant is suspended (#46)', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        name: 'k',
        scopes: [],
        tenantId: 't1',
        expiresAt: null,
        tenant: { state: 'suspended' },
      });
      await expect(service.validate('sk_0000')).resolves.toBeNull();
    });

    it('updates lastUsedAt and returns sanitized key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-1',
        name: 'k',
        scopes: ['services:read'],
        tenantId: 't1',
        expiresAt: null,
        tenant: { state: 'active' },
      });
      prisma.apiKey.update.mockResolvedValue({});

      const result = await service.validate('sk_' + 'a'.repeat(64));

      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { lastUsedAt: expect.any(Date) },
      });
      expect(result).toEqual(
        expect.objectContaining({ id: 'key-1', scopes: ['services:read'] }),
      );
      expect(result).not.toHaveProperty('hash');
    });
  });

  describe('delete (immediate revocation)', () => {
    it('throws NotFound when key does not exist', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);
      await expect(service.delete('nope')).rejects.toThrow(NotFoundException);
    });

    it('removes the record and audits', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({ id: 'key-1', name: 'k' });
      prisma.apiKey.delete.mockResolvedValue({});

      await service.delete('key-1', 'u1');

      expect(prisma.apiKey.delete).toHaveBeenCalledWith({
        where: { id: 'key-1' },
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'api_key.deleted' }),
      );
    });

    it('kills a previously valid token (validate returns null)', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);
      await expect(service.validate('sk_0000')).resolves.toBeNull();
    });
  });
});

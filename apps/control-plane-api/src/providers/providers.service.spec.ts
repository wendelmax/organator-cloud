import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { encryptSecret, decryptSecret } from '@organator/cloud-providers';

describe('ProvidersService', () => {
  let service: ProvidersService;
  let prisma: any;

  const mockAudit = { record: jest.fn().mockResolvedValue(undefined) };

  const mockPrisma = () => ({
    providerCredential: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  });

  const credentialRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'cred-1',
    type: 'VERCEL',
    name: 'Vercel principal',
    encryptedData: { apiToken: encryptSecret('sk_test_abc123secret') },
    config: { teamId: 'team_x' },
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    prisma = mockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvidersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<ProvidersService>(ProvidersService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('encrypts secrets at rest and never returns them decrypted', async () => {
      prisma.providerCredential.create.mockResolvedValue(credentialRow());

      const result = await service.create({
        type: 'VERCEL',
        name: 'Vercel principal',
        secrets: { apiToken: 'sk_test_abc123secret' },
        config: { teamId: 'team_x' },
      });

      const stored = prisma.providerCredential.create.mock.calls[0][0].data;
      expect(stored.encryptedData.apiToken).not.toContain(
        'sk_test_abc123secret',
      );
      expect(decryptSecret(stored.encryptedData.apiToken)).toBe(
        'sk_test_abc123secret',
      );

      expect(result.secrets.apiToken).toBe('sk-****');
      expect(JSON.stringify(result)).not.toContain('abc123secret');

      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'provider_credential.created' }),
      );
    });

    it('throws BadRequest for invalid type', async () => {
      await expect(
        service.create({ type: 'DIGITALOCEAN' as any, name: 'x', secrets: {} }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest when a required secret is missing', async () => {
      await expect(
        service.create({ type: 'AWS', name: 'AWS', secrets: {} }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({
          type: 'AWS',
          name: 'AWS',
          secrets: { accessKeyId: 'AKIA123' },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('get/list', () => {
    it('masks secrets on read', async () => {
      prisma.providerCredential.findUnique.mockResolvedValue(credentialRow());
      const result = await service.get('cred-1');
      expect(result.secrets.apiToken).toBe('sk-****');
    });

    it('throws NotFound when credential is missing', async () => {
      prisma.providerCredential.findUnique.mockResolvedValue(null);
      await expect(service.get('nope')).rejects.toThrow(NotFoundException);
    });

    it('masks every credential on list', async () => {
      prisma.providerCredential.findMany.mockResolvedValue([
        credentialRow({ id: 'a', type: 'AWS' }),
        credentialRow({ id: 'b', type: 'VPS' }),
      ]);
      const result = await service.list();
      expect(result).toHaveLength(2);
      for (const item of result) {
        expect(JSON.stringify(item)).not.toContain('abc123secret');
      }
    });
  });

  describe('update (rotation)', () => {
    it('re-encrypts only provided secret fields and keeps the rest', async () => {
      const existing = credentialRow({ type: 'AWS' });
      prisma.providerCredential.findUnique.mockResolvedValue(existing);
      prisma.providerCredential.update.mockResolvedValue({
        ...existing,
        encryptedData: {
          accessKeyId: encryptSecret('AKIA_NEW'),
          secretAccessKey: existing.encryptedData.secretAccessKey,
        },
      });

      const result = await service.update(
        'cred-1',
        { secrets: { accessKeyId: 'AKIA_NEW' } },
        'user-1',
      );

      expect(result.secrets.accessKeyId).toBe('AKIA-****');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'provider_credential.updated',
          changes: expect.objectContaining({ rotatedFields: ['accessKeyId'] }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('deletes and audits', async () => {
      prisma.providerCredential.findUnique.mockResolvedValue(credentialRow());
      prisma.providerCredential.delete.mockResolvedValue(credentialRow());

      await service.remove('cred-1', 'user-1');

      expect(prisma.providerCredential.delete).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
      });
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'provider_credential.deleted' }),
      );
    });

    it('throws NotFound on missing credential', async () => {
      prisma.providerCredential.findUnique.mockResolvedValue(null);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('testConnection', () => {
    it('returns mock success for mock credentials', async () => {
      prisma.providerCredential.findUnique.mockResolvedValue(
        credentialRow({
          type: 'VERCEL',
          encryptedData: { apiToken: encryptSecret('mock-token') },
        }),
      );

      const result = await service.testConnection('cred-1');
      expect(result.ok).toBe(true);
      expect(result.mock).toBe(true);
    });
  });

  describe('resolveForDeploy', () => {
    it('returns decrypted secrets ready for the worker', async () => {
      prisma.providerCredential.findFirst.mockResolvedValue(
        credentialRow({
          type: 'VERCEL',
          encryptedData: { apiToken: encryptSecret('sk_live_worker-token') },
        }),
      );

      const resolved = await service.resolveForDeploy('VERCEL');
      expect(resolved?.secrets.apiToken).toBe('sk_live_worker-token');
      expect(resolved?.config.teamId).toBe('team_x');
    });

    it('returns null when no credential exists for the type', async () => {
      prisma.providerCredential.findFirst.mockResolvedValue(null);
      expect(await service.resolveForDeploy('AWS')).toBeNull();
    });

    it('returns null for unknown provider types', async () => {
      expect(await service.resolveForDeploy('DIGITALOCEAN')).toBeNull();
    });
  });
});

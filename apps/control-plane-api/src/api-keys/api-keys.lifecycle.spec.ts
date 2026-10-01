import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiKeysService } from './api-keys.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('ApiKeysService — lifecycle and tenant isolation', () => {
  let prisma: any;
  let audit: any;
  let service: ApiKeysService;
  const row = (o: Record<string, unknown> = {}) => ({
    id: 'k1',
    name: 'ci',
    hash: 'secret-hash',
    scopes: ['services:read'],
    tenantId: 't1',
    expiresAt: null,
    ...o,
  });

  beforeEach(() => {
    prisma = {
      apiKey: {
        findMany: jest.fn().mockResolvedValue([row(), row({ id: 'k2' })]),
        findFirst: jest.fn().mockResolvedValue(row()),
        findUnique: jest.fn().mockResolvedValue(row()),
        update: jest.fn((args) => Promise.resolve(row(args.data))),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new ApiKeysService(prisma, audit);
  });

  describe('list / get', () => {
    it('never returns the hash', async () => {
      const keys = await service.list('t1');
      keys.forEach((k: any) => expect(k).not.toHaveProperty('hash'));
      expect(await service.get('k1', 't1')).not.toHaveProperty('hash');
    });

    it('filters by tenant only when given', async () => {
      await service.list('t1');
      await service.list();
      expect(prisma.apiKey.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1' });
      expect(prisma.apiKey.findMany.mock.calls[1][0].where).toBeUndefined();
    });

    it('get is scoped to the tenant and 404s otherwise', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);
      await expect(service.get('k1', 't2')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({ where: { id: 'k1', tenantId: 't2' } });
    });
  });

  describe('update', () => {
    it('404s for unknown keys', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);
      await expect(service.update('x', { name: 'n' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('forbids updating a key of another tenant', async () => {
      await expect(service.update('k1', { name: 'n' }, 'u', 't2')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it('rejects invalid expiration dates', async () => {
      await expect(service.update('k1', { expiresAt: 'not-a-date' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('only writes provided fields, trims the name and audits', async () => {
      const updated = await service.update('k1', { name: '  deploy bot ' }, 'u1', 't1');
      expect(prisma.apiKey.update).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { name: 'deploy bot' } });
      expect(updated).not.toHaveProperty('hash');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_key.updated', actorId: 'u1', resourceId: 'k1' }));
    });

    it('can clear the expiration with null', async () => {
      await service.update('k1', { expiresAt: null });
      expect(prisma.apiKey.update.mock.calls[0][0].data).toEqual({ expiresAt: null });
    });
  });

  describe('delete', () => {
    it('404s for unknown keys and forbids other tenants', async () => {
      prisma.apiKey.findUnique.mockResolvedValueOnce(null);
      await expect(service.delete('x')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.delete('k1', 'u', 't2')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.apiKey.delete).not.toHaveBeenCalled();
    });

    it('deletes (immediate revocation) and audits', async () => {
      await service.delete('k1', 'u1', 't1');
      expect(prisma.apiKey.delete).toHaveBeenCalledWith({ where: { id: 'k1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_key.deleted', changes: { name: 'ci' } }));
    });
  });

  describe('validate', () => {
    it('rejects tokens without the sk_ prefix without hitting the database', async () => {
      await expect(service.validate('pk_live_x')).resolves.toBeNull();
      await expect(service.validate('')).resolves.toBeNull();
      expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
    });

    it('looks keys up by sha256 hash and touches lastUsedAt', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(row({ tenant: { state: 'active' } }));
      const key = await service.validate('sk_abc');
      expect(prisma.apiKey.findUnique.mock.calls[0][0].where).toEqual({ hash: sha256('sk_abc') });
      expect(prisma.apiKey.update).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { lastUsedAt: expect.any(Date) } });
      expect(key).toMatchObject({ id: 'k1', scopes: ['services:read'], tenantId: 't1' });
    });

    it('still authenticates if updating lastUsedAt fails', async () => {
      prisma.apiKey.update.mockRejectedValue(new Error('db'));
      await expect(service.validate('sk_abc')).resolves.toMatchObject({ id: 'k1' });
    });

    it('rejects unknown, expired and blocked-tenant keys', async () => {
      prisma.apiKey.findUnique.mockResolvedValueOnce(null);
      await expect(service.validate('sk_a')).resolves.toBeNull();
      prisma.apiKey.findUnique.mockResolvedValueOnce(row({ expiresAt: new Date(Date.now() - 1000) }));
      await expect(service.validate('sk_a')).resolves.toBeNull();
      for (const state of ['suspended', 'offboarding', 'deleted']) {
        prisma.apiKey.findUnique.mockResolvedValueOnce(row({ tenant: { state } }));
        await expect(service.validate('sk_a')).resolves.toBeNull();
      }
    });

    it('accepts keys whose expiration is in the future', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() + 60000) }));
      await expect(service.validate('sk_a')).resolves.not.toBeNull();
    });
  });

  describe('resolveTenantId', () => {
    it('returns the tenant of a valid tenant key, without side effects', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({ tenantId: 't1', expiresAt: null, tenant: { state: 'past_due' } });
      await expect(service.resolveTenantId('sk_a')).resolves.toBe('t1');
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it.each([
      ['non sk_ token', 'jwt', undefined],
      ['unknown key', 'sk_a', null],
      ['expired key', 'sk_a', { tenantId: 't1', expiresAt: new Date(0) }],
      ['platform key', 'sk_a', { tenantId: null, expiresAt: null }],
      ['suspended tenant', 'sk_a', { tenantId: 't1', expiresAt: null, tenant: { state: 'suspended' } }],
    ])('returns null for %s', async (_l, token, record) => {
      if (record !== undefined) prisma.apiKey.findUnique.mockResolvedValue(record);
      await expect(service.resolveTenantId(token)).resolves.toBeNull();
    });
  });
});

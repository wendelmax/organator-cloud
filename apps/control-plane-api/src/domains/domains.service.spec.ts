import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DomainsService } from './domains.service';

describe('DomainsService', () => {
  let prisma: any;
  let audit: any;
  let service: DomainsService;

  beforeEach(() => {
    prisma = {
      microservice: { findFirst: jest.fn() },
      domain: {
        create: jest.fn((args) => Promise.resolve({ id: 'dom-1', ...args.data })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new DomainsService(prisma, audit);
  });

  describe('create', () => {
    it.each(['localhost', '-bad.com', 'bad-.com', 'a..b.com', 'app.acme.com.', 'has space.com', 'under_score.com', `${'a'.repeat(64)}.com`])(
      'rejects invalid hostname %s',
      async (hostname) => {
        await expect(service.create('t1', { hostname, provider: 'route53' }, 'u1')).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prisma.domain.create).not.toHaveBeenCalled();
      },
    );

    it.each(['acme.com', 'api.eu-west.acme.co', 'x1.io'])('accepts valid hostname %s', async (hostname) => {
      await expect(service.create('t1', { hostname, provider: 'route53' }, 'u1')).resolves.toMatchObject({ hostname });
    });

    it('rejects unsupported DNS providers', async () => {
      await expect(
        service.create('t1', { hostname: 'app.acme.com', provider: 'godaddy' }, 'u1'),
      ).rejects.toThrow('Provedor DNS inválido');
    });

    it('refuses to attach a microservice from another tenant', async () => {
      prisma.microservice.findFirst.mockResolvedValue(null);
      await expect(
        service.create('t1', { hostname: 'app.acme.com', provider: 'vercel', microserviceId: 'svc-x' }, 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.microservice.findFirst).toHaveBeenCalledWith({ where: { id: 'svc-x', tenantId: 't1' } });
    });

    it('lowercases the hostname, persists and audits', async () => {
      const domain = await service.create('t1', { hostname: 'App.Acme.COM', provider: 'cloudflare' }, 'u1');

      expect(domain).toMatchObject({ hostname: 'app.acme.com', provider: 'cloudflare', microserviceId: null });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'u1', action: 'domain.created', resourceId: 'dom-1' }),
      );
    });
  });

  it('lists domains filtered by microservice when provided', async () => {
    await service.list('t1', 'svc-1');
    expect(prisma.domain.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', microserviceId: 'svc-1' },
      orderBy: { createdAt: 'desc' },
    });
    await service.list('t1');
    expect(prisma.domain.findMany).toHaveBeenLastCalledWith({
      where: { tenantId: 't1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  describe('remove', () => {
    it('throws when the domain is not in the tenant', async () => {
      prisma.domain.findFirst.mockResolvedValue(null);
      await expect(service.remove('t1', 'dom-1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.domain.delete).not.toHaveBeenCalled();
    });

    it('deletes and audits', async () => {
      prisma.domain.findFirst.mockResolvedValue({ id: 'dom-1', hostname: 'a.b.com' });
      await expect(service.remove('t1', 'dom-1', 'u1')).resolves.toEqual({ deleted: true });
      expect(prisma.domain.delete).toHaveBeenCalledWith({ where: { id: 'dom-1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'domain.deleted' }));
    });
  });

  describe('validate', () => {
    it('throws for unknown domain', async () => {
      prisma.domain.findFirst.mockResolvedValue(null);
      await expect(service.validate('t1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('suggests provisioning while the domain is not active', async () => {
      prisma.domain.findFirst.mockResolvedValue({ id: 'd', hostname: 'a.b.com', status: 'pending', tlsStatus: 'pending' });
      await expect(service.validate('t1', 'd')).resolves.toMatchObject({ nextAction: 'provision-domain' });
    });

    it('reports no action for active domains', async () => {
      prisma.domain.findFirst.mockResolvedValue({ id: 'd', hostname: 'a.b.com', status: 'active', tlsStatus: 'issued' });
      await expect(service.validate('t1', 'd')).resolves.toMatchObject({ nextAction: 'none', tlsStatus: 'issued' });
    });
  });
});

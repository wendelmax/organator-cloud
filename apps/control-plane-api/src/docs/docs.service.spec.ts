import { NotFoundException } from '@nestjs/common';
import { DocsService } from './docs.service';

describe('DocsService', () => {
  let prisma: any;
  let service: DocsService;
  const input = {
    microserviceId: 'svc-1',
    title: 'API',
    version: '1.0.0',
    openApiSpec: '{}',
  };

  beforeEach(() => {
    prisma = {
      microservice: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'svc-new' }),
      },
      apiDoc: {
        create: jest.fn((args) =>
          Promise.resolve({ id: 'doc-1', ...args.data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn((args) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
      },
    };
    service = new DocsService(prisma);
  });

  describe('createDoc', () => {
    it('attaches to the microservice by id within the tenant, private by default', async () => {
      prisma.microservice.findFirst.mockResolvedValueOnce({ id: 'svc-1' });
      const doc = await service.createDoc(input, 't1');
      expect(prisma.microservice.findFirst).toHaveBeenCalledWith({
        where: { id: 'svc-1', tenantId: 't1' },
      });
      expect(doc).toMatchObject({ microserviceId: 'svc-1', isPublic: false });
      expect(prisma.microservice.create).not.toHaveBeenCalled();
    });

    it("never attaches a doc to another tenant's service", async () => {
      // O id existe, mas em outro tenant: a busca filtrada não o encontra e o
      // doc vai para um serviço novo do próprio tenant.
      await service.createDoc(input, 't1');
      expect(prisma.microservice.findUnique).not.toHaveBeenCalled();
      expect(prisma.microservice.create).toHaveBeenCalledWith({
        data: { tenantId: 't1', name: 'svc-1', cloudProvider: 'MANUAL' },
      });
    });

    it('lets a platform admin attach by id in any tenant', async () => {
      prisma.microservice.findFirst.mockResolvedValueOnce({ id: 'svc-x' });
      await service.createDoc(input, 't-platform', null);
      expect(prisma.microservice.findFirst).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
      });
    });

    it('falls back to lookup by name inside the tenant', async () => {
      prisma.microservice.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'svc-by-name' });
      const doc = await service.createDoc(
        { ...input, microserviceId: 'billing', isPublic: true },
        't1',
      );
      expect(prisma.microservice.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 't1', name: 'billing' },
      });
      expect(doc).toMatchObject({
        microserviceId: 'svc-by-name',
        isPublic: true,
      });
    });

    it('creates a MANUAL microservice when none matches', async () => {
      const doc = await service.createDoc(
        { ...input, microserviceId: 'new-svc' },
        't1',
      );
      expect(prisma.microservice.create).toHaveBeenCalledWith({
        data: { tenantId: 't1', name: 'new-svc', cloudProvider: 'MANUAL' },
      });
      expect(doc.microserviceId).toBe('svc-new');
    });
  });

  it('lists docs by service and public docs', async () => {
    await service.getDocsByService('svc-1');
    expect(prisma.apiDoc.findMany).toHaveBeenCalledWith({
      where: { microserviceId: 'svc-1' },
      orderBy: { createdAt: 'desc' },
    });
    await service.getAllPublicDocs();
    expect(prisma.apiDoc.findMany).toHaveBeenLastCalledWith({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it("hides another tenant's docs (404)", async () => {
    await expect(
      service.getDocsByService('svc-1', 't1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.apiDoc.findMany).not.toHaveBeenCalled();

    prisma.microservice.findFirst.mockResolvedValueOnce({ id: 'svc-1' });
    await service.getDocsByService('svc-1', 't1');
    expect(prisma.apiDoc.findMany).toHaveBeenCalled();
  });

  describe('toggleVisibility', () => {
    it("cannot publish another tenant's private doc", async () => {
      prisma.apiDoc.findUnique.mockResolvedValue({
        id: 'doc-1',
        microservice: { tenantId: 't-other' },
      });
      await expect(
        service.toggleVisibility('doc-1', true, 't1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.apiDoc.update).not.toHaveBeenCalled();
    });

    it('throws when the doc does not exist', async () => {
      prisma.apiDoc.findUnique.mockResolvedValue(null);
      await expect(service.toggleVisibility('x', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('updates the visibility flag', async () => {
      prisma.apiDoc.findUnique.mockResolvedValue({ id: 'doc-1' });
      await expect(service.toggleVisibility('doc-1', true)).resolves.toEqual({
        id: 'doc-1',
        isPublic: true,
      });
    });
  });
});

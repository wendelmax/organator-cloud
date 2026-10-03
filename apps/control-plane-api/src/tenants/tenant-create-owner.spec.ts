import { TenantsService } from './tenants.service';

describe('TenantsService.createTenant — owner assignment', () => {
  const tenant = { id: 't-new', slug: 'acme', plan: 'free' };
  let prisma: any;
  let service: TenantsService;
  let passwordReset: { sendActivation: jest.Mock };

  beforeEach(() => {
    passwordReset = { sendActivation: jest.fn() };
    prisma = {
      user: { findUnique: jest.fn() },
      tenant: {
        create: jest.fn().mockResolvedValue(tenant),
        // 1ª chamada: checagem de slug livre; depois, o tenant criado.
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue(tenant),
      },
      tenantMembership: { upsert: jest.fn().mockResolvedValue({}) },
    };
    service = new TenantsService(
      prisma,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      undefined,
      passwordReset as never,
    );
  });

  it('does not move an existing user out of their home tenant; grants OWNER membership', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1' });

    await service.createTenant('Acme', 'free', 'ops@organator.app');

    const data = prisma.tenant.create.mock.calls[0][0].data;
    expect(data.users).toBeUndefined();
    expect(prisma.tenantMembership.upsert).toHaveBeenCalledWith({
      where: { tenantId_userId: { tenantId: 't-new', userId: 'admin-1' } },
      create: {
        tenantId: 't-new',
        userId: 'admin-1',
        role: 'OWNER',
        status: 'active',
      },
      update: { role: 'OWNER', status: 'active' },
    });
  });

  it('creates a new OWNER user that must set a password when the e-mail is unknown', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await service.createTenant('Acme', 'free', 'new-owner@acme.com');

    const created = prisma.tenant.create.mock.calls[0][0].data.users.create[0];
    expect(created).toMatchObject({
      email: 'new-owner@acme.com',
      role: 'OWNER',
      mustChangePassword: true,
    });
    expect(prisma.tenantMembership.upsert).not.toHaveBeenCalled();
  });

  it('e-mails the new owner a link to set the password', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'owner-1' });

    await service.createTenant('Acme', 'free', 'new-owner@acme.com');

    expect(passwordReset.sendActivation).toHaveBeenCalledWith('owner-1');
  });

  it('does not send an activation to an existing user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1' });
    await service.createTenant('Acme', 'free', 'ops@organator.app');
    expect(passwordReset.sendActivation).not.toHaveBeenCalled();
  });

  it('creates the tenant without users when no owner e-mail is given', async () => {
    await service.createTenant('Acme', 'free');
    expect(prisma.tenant.create.mock.calls[0][0].data.users).toBeUndefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a name whose address (slug) is already taken, before creating anything', async () => {
    prisma.tenant.findUnique.mockReset().mockResolvedValue(tenant);
    await expect(
      service.createTenant('Acme', 'free', 'x@acme.com'),
    ).rejects.toThrow(/Já existe uma organização com o endereço "acme"/);
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });
});

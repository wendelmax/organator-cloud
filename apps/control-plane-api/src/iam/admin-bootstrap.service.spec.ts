jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

import { Logger } from '@nestjs/common';
import { AdminBootstrapService } from './admin-bootstrap.service';

describe('AdminBootstrapService', () => {
  let prisma: any;
  let service: AdminBootstrapService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn().mockResolvedValue({}) },
      tenant: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'platform-t' }),
      },
    };
    service = new AdminBootstrapService(prisma);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    delete process.env.PLATFORM_ADMIN_EMAIL;
  });

  afterEach(() => jest.restoreAllMocks());

  it('does nothing when the admin already exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await service.onApplicationBootstrap();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('creates the platform tenant and an admin that must change password', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await service.onApplicationBootstrap();

    expect(prisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Platform', slug: 'platform', plan: 'enterprise' },
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'admin@organator.app',
        password: 'hashed',
        role: 'PLATFORM_ADMIN',
        tenantId: 'platform-t',
        mustChangePassword: true,
      }),
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('admin@organator.app'),
    );
  });

  it('reuses an existing platform tenant and honors PLATFORM_ADMIN_EMAIL', async () => {
    process.env.PLATFORM_ADMIN_EMAIL = 'root@corp.io';
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.tenant.findUnique.mockResolvedValue({ id: 'existing-t' });

    await service.onApplicationBootstrap();

    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'root@corp.io',
        tenantId: 'existing-t',
      }),
    });
    delete process.env.PLATFORM_ADMIN_EMAIL;
  });
});

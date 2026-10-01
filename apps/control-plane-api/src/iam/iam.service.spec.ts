import { Logger } from '@nestjs/common';
import { IamService } from './iam.service';

describe('IamService', () => {
  const originalEnv = { ...process.env };
  let prisma: any;
  let service: IamService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    prisma = {
      iamGroup: { upsert: jest.fn((args) => Promise.resolve({ name: args.create.name })) },
    };
    service = new IamService(prisma);
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    delete process.env.VOIDAUTH_URL;
    delete process.env.VOIDAUTH_ADMIN_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('upserts an idempotent tenant-{slug} group', async () => {
    await expect(service.ensureTenantGroup('t1', 'acme')).resolves.toBe('tenant-acme');
    expect(prisma.iamGroup.upsert).toHaveBeenCalledWith({
      where: { tenantId_name: { tenantId: 't1', name: 'tenant-acme' } },
      create: { tenantId: 't1', name: 'tenant-acme' },
      update: {},
    });
  });

  it('skips the VoidAuth invite when not configured', async () => {
    await expect(service.linkOwnerAfterCheckout('t1', 'acme', 'o@acme.com')).resolves.toEqual({
      group: 'tenant-acme',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invites the owner on VoidAuth when configured', async () => {
    process.env.VOIDAUTH_URL = 'https://auth.example.com/';
    process.env.VOIDAUTH_ADMIN_TOKEN = 'admintok';
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await service.linkOwnerAfterCheckout('t1', 'acme', 'o@acme.com');

    expect(fetchMock).toHaveBeenCalledWith('https://auth.example.com/api/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admintok' },
      body: JSON.stringify({ email: 'o@acme.com', group: 'tenant-acme' }),
    });
  });

  it('does not fail checkout linking when the invite fails', async () => {
    process.env.VOIDAUTH_URL = 'https://auth.example.com';
    process.env.VOIDAUTH_ADMIN_TOKEN = 'admintok';
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(service.linkOwnerAfterCheckout('t1', 'acme', 'o@acme.com')).resolves.toEqual({
      group: 'tenant-acme',
    });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
  });
});

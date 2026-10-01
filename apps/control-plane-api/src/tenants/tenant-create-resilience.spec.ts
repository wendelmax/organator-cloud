import { TenantsService } from './tenants.service';

describe('TenantsService.createTenant — provisioning queue outage', () => {
  const tenant = { id: 't-new', slug: 'acme', plan: 'free' };

  function build(queueAdd: jest.Mock) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      tenant: {
        create: jest.fn().mockResolvedValue(tenant),
        findUnique: jest.fn().mockResolvedValue(tenant),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new TenantsService(
      prisma as never,
      {} as never,
      audit as never,
      {} as never,
      { add: queueAdd } as never,
    );
    return { service, audit };
  }

  it('keeps the tenant and audits when enqueueing infra provisioning fails', async () => {
    const { service, audit } = build(
      jest
        .fn()
        .mockRejectedValue(
          new Error(
            "Stream isn't writeable and enableOfflineQueue options is false",
          ),
        ),
    );

    await expect(
      service.createTenant('Acme', 'free', undefined, { actorId: 'admin' }),
    ).resolves.toBe(tenant);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.infra_enqueue_failed',
        resourceId: 't-new',
        actorId: 'admin',
      }),
    );
  });

  it('enqueues provisioning with an id BullMQ accepts', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job' });
    const { service } = build(add);
    await service.createTenant('Acme', 'free');
    const [, , opts] = add.mock.calls[0];
    expect(opts.jobId).not.toContain(':');
  });
});

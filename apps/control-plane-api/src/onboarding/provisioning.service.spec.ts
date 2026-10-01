import { ProvisioningService } from './provisioning.service';

describe('ProvisioningService', () => {
  let prisma: any;
  let queue: any;
  let audit: any;
  let service: ProvisioningService;

  beforeEach(() => {
    prisma = { deployment: { findUnique: jest.fn().mockResolvedValue(null) } };
    queue = {
      add: jest.fn((_name, _data, opts) => Promise.resolve({ id: opts.jobId })),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new ProvisioningService(prisma, queue, audit);
  });

  it('enqueues initial provisioning with an idempotent job id and audits', async () => {
    const result = await service.provision('t1', 'u1');

    expect(queue.add).toHaveBeenCalledWith(
      'deploy-tenant-infra',
      {
        tenantId: 't1',
        action: 'INITIAL_PROVISIONING',
        idempotencyKey: 'tenant-infra:t1',
        actorId: 'u1',
      },
      { jobId: 'tenant-infra__t1', removeOnComplete: false },
    );
    expect(result).toEqual({
      jobId: 'tenant-infra__t1',
      status: 'QUEUED',
      idempotencyKey: 'tenant-infra:t1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TENANT_INFRA_PROVISION_QUEUED',
        resourceId: 't1',
      }),
    );
  });

  it.each(['RUNNING', 'SUCCESS'])(
    'returns the existing deployment when already %s',
    async (status) => {
      const existing = { id: 'dep', status };
      prisma.deployment.findUnique.mockResolvedValue(existing);

      await expect(service.provision('t1', 'u1')).resolves.toBe(existing);
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it('re-enqueues when the previous attempt failed', async () => {
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'dep',
      status: 'FAILED',
    });
    await service.provision('t1', 'u1');
    expect(queue.add).toHaveBeenCalled();
  });

  it('enqueues deprovisioning and audits', async () => {
    const result = await service.deprovision('t1', 'u1');
    expect(queue.add).toHaveBeenCalledWith(
      'deprovision-tenant-infra',
      expect.objectContaining({
        action: 'DEPROVISION',
        idempotencyKey: 'tenant-deprovision:t1',
      }),
      { jobId: 'tenant-deprovision__t1', removeOnComplete: false },
    );
    expect(result.status).toBe('QUEUED');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TENANT_INFRA_DEPROVISION_QUEUED' }),
    );
  });
});

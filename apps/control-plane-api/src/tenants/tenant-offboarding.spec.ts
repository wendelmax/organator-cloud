const cancelCustomerSubscriptions = jest.fn();
jest.mock('../billing/stripe-subscriptions', () => ({
  cancelCustomerSubscriptions,
}));

import { BadRequestException } from '@nestjs/common';
import { TenantsService } from './tenants.service';

describe('TenantsService — offboarding', () => {
  const tenant = { id: 't1', slug: 'acme', stripeId: 'cus_1' };
  let prisma: any;
  let audit: { record: jest.Mock };
  let lifecycle: { markOffboarding: jest.Mock };
  let queue: { add: jest.Mock };
  let service: TenantsService;

  beforeEach(() => {
    prisma = { tenant: { findUnique: jest.fn().mockResolvedValue(tenant) } };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    lifecycle = {
      markOffboarding: jest
        .fn()
        .mockResolvedValue({ id: 't1', state: 'offboarding' }),
    };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    cancelCustomerSubscriptions.mockReset().mockResolvedValue(['sub_1']);
    service = new TenantsService(
      prisma,
      {} as never,
      audit as never,
      lifecycle as never,
      queue as never,
    );
  });

  it('blocks access, cancels billing and queues the infra teardown', async () => {
    const result = await service.triggerOffboard('t1', 'admin-1');

    expect(result).toEqual({ jobId: 'job-1', status: 'QUEUED' });
    expect(lifecycle.markOffboarding).toHaveBeenCalledWith('t1', {
      reason: 'manual.offboard',
      actorId: 'admin-1',
    });
    expect(cancelCustomerSubscriptions).toHaveBeenCalledWith('cus_1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.billing_canceled',
        changes: { subscriptions: ['sub_1'] },
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'offboard-tenant-infra',
      { tenantId: 't1', slug: 'acme', actorId: 'admin-1' },
      { jobId: 'offboard-tenant-infra__t1' },
    );
    // A transição acontece antes de a fila ser acionada.
    expect(lifecycle.markOffboarding.mock.invocationCallOrder[0]).toBeLessThan(
      queue.add.mock.invocationCallOrder[0],
    );
  });

  it('still offboards when Stripe fails, leaving it in the audit log', async () => {
    cancelCustomerSubscriptions.mockRejectedValue(new Error('Stripe down'));

    await expect(service.triggerOffboard('t1')).resolves.toMatchObject({
      status: 'QUEUED',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.billing_cancel_failed',
        changes: { customer: 'cus_1', error: 'Stripe down' },
      }),
    );
  });

  it('does not queue anything when the transition is not allowed', async () => {
    lifecycle.markOffboarding.mockRejectedValue(
      new BadRequestException('Transição inválida: deleted -> offboarding'),
    );

    await expect(service.triggerOffboard('t1')).rejects.toThrow(
      BadRequestException,
    );
    expect(cancelCustomerSubscriptions).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('archive also stops billing but keeps the infrastructure', async () => {
    await service.archiveTenant('t1', { actorId: 'admin-1' });

    expect(lifecycle.markOffboarding).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ reason: 'manual.admin', actorId: 'admin-1' }),
    );
    expect(cancelCustomerSubscriptions).toHaveBeenCalledWith('cus_1');
    expect(queue.add).not.toHaveBeenCalled();
  });
});

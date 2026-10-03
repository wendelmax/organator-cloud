const cancelCustomerSubscriptions = jest.fn().mockResolvedValue(['sub_1']);
jest.mock('./stripe-subscriptions', () => ({ cancelCustomerSubscriptions }));

import { ROLES_KEY } from '../auth/roles.decorator';
import { BillingController } from './billing.controller';
import { DunningService } from './dunning.service';

const DAY = 24 * 60 * 60 * 1000;

describe('DunningService (#97)', () => {
  let cases: Map<string, any>;
  let prisma: any;
  let audit: { record: jest.Mock };
  let mail: { send: jest.Mock };
  let lifecycle: any;
  let tenants: { changePlan: jest.Mock };
  let service: DunningService;
  let plan: any;

  beforeEach(() => {
    cases = new Map();
    plan = { slug: 'pro', dunningGraceDays: 10, dunningEndAction: 'suspend' };
    const byId = (id: string) => [...cases.values()].find((c) => c.id === id);
    prisma = {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 't1', plan: 'Pro', stripeId: 'cus_1' }),
      },
      billingPlan: { findUnique: jest.fn(async () => plan) },
      dunningCase: {
        upsert: jest.fn(async ({ where, create, update }) => {
          const existing = cases.get(where.invoiceId);
          const next = existing
            ? { ...existing, ...update }
            : {
                id: `case-${cases.size + 1}`,
                status: 'OPEN',
                noticesSent: [],
                ...create,
              };
          cases.set(where.invoiceId, next);
          return next;
        }),
        findUnique: jest.fn(async ({ where }) =>
          where.invoiceId
            ? (cases.get(where.invoiceId) ?? null)
            : (byId(where.id) ?? null),
        ),
        findMany: jest.fn(async () =>
          [...cases.values()].filter((c) => c.status === 'OPEN'),
        ),
        update: jest.fn(async ({ where, data }) => {
          const c = byId(where.id);
          Object.assign(c, data);
          return c;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const c = byId(where.id);
          if (!c || c.status !== where.status) return { count: 0 };
          Object.assign(c, data);
          return { count: 1 };
        }),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { email: 'owner@acme.com' },
            { email: 'fin@acme.com' },
          ]),
      },
    };
    audit = { record: jest.fn() };
    mail = { send: jest.fn().mockResolvedValue(true) };
    lifecycle = {
      enterPastDue: jest.fn(),
      restoreActive: jest.fn(),
      markSuspended: jest.fn(),
    };
    tenants = { changePlan: jest.fn() };
    cancelCustomerSubscriptions.mockClear();
    service = new DunningService(
      prisma,
      audit as any,
      mail as any,
      lifecycle,
      tenants as any,
    );
  });

  const invoice = (attempt: number, next?: number) => ({
    id: 'in_1',
    amount_due: 4900,
    currency: 'usd',
    attempt_count: attempt,
    next_payment_attempt: next,
  });

  describe('payment failures (Stripe retries)', () => {
    it('opens one case per invoice with the plan grace and enters past_due', async () => {
      const before = Date.now();
      const created = await service.onPaymentFailed(
        't1',
        invoice(1, 1_800_000_000),
      );

      expect(created).toMatchObject({
        invoiceId: 'in_1',
        amountDue: 4900,
        attemptCount: 1,
      });
      const grace = created.graceEndsAt.getTime() - before;
      expect(grace).toBeGreaterThanOrEqual(10 * DAY - 1000);
      expect(grace).toBeLessThanOrEqual(10 * DAY + 1000);
      expect(lifecycle.enterPastDue).toHaveBeenCalledWith('t1', {
        graceEndsAt: created.graceEndsAt,
        reason: 'invoice.payment_failed',
      });
      expect(mail.send).toHaveBeenCalledTimes(2);
      expect(mail.send.mock.calls[0][0].text).toContain('tentativa 1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.dunning_payment_failed' }),
      );
    });

    it('keeps the grace deadline on retries and warns once per attempt', async () => {
      const first = await service.onPaymentFailed('t1', invoice(1));
      const deadline = first.graceEndsAt;
      await service.onPaymentFailed('t1', invoice(2));
      await service.onPaymentFailed('t1', invoice(2)); // webhook repetido

      expect(cases.get('in_1').graceEndsAt).toEqual(deadline);
      expect(cases.get('in_1').attemptCount).toBe(2);
      // 2 destinatários × 2 estágios (tentativa 1 e 2).
      expect(mail.send).toHaveBeenCalledTimes(4);
      expect(cases.get('in_1').noticesSent).toEqual(['failed:1', 'failed:2']);
    });

    it('falls back to TENANT_GRACE_PERIOD_DAYS without a plan policy', async () => {
      plan = null;
      const before = Date.now();
      const created = await service.onPaymentFailed('t1', invoice(1));
      expect(created.graceEndsAt.getTime() - before).toBeLessThanOrEqual(
        7 * DAY + 1000,
      );
    });
  });

  it('closes the case and reactivates the tenant when the invoice is paid', async () => {
    await service.onPaymentFailed('t1', invoice(1));
    await expect(service.onInvoicePaid('t1', { id: 'in_1' })).resolves.toEqual({
      recovered: true,
    });

    expect(cases.get('in_1').status).toBe('RECOVERED');
    expect(lifecycle.restoreActive).toHaveBeenCalledWith('t1', {
      reason: 'invoice.paid',
    });
    expect(cases.get('in_1').noticesSent).toContain('recovered');
    await expect(
      service.onInvoicePaid('t1', { id: 'in_unknown' }),
    ).resolves.toBeNull();
  });

  describe('sweep', () => {
    it('warns once when the grace is about to end', async () => {
      await service.onPaymentFailed('t1', invoice(1));
      const almost = new Date(cases.get('in_1').graceEndsAt.getTime() - DAY);
      await service.sweep(almost);
      await service.sweep(almost);
      expect(cases.get('in_1').noticesSent).toEqual([
        'failed:1',
        'grace_ending',
      ]);
      expect(lifecycle.markSuspended).not.toHaveBeenCalled();
    });

    it('suspends when the grace ends (default policy), only once', async () => {
      await service.onPaymentFailed('t1', invoice(1));
      const after = new Date(cases.get('in_1').graceEndsAt.getTime() + 1000);

      await expect(service.sweep(after)).resolves.toEqual({
        checked: 1,
        actions: 1,
      });
      await service.sweep(after);

      expect(lifecycle.markSuspended).toHaveBeenCalledTimes(1);
      expect(lifecycle.markSuspended).toHaveBeenCalledWith('t1', {
        reason: 'dunning.grace_expired',
      });
      expect(cases.get('in_1').status).toBe('SUSPENDED');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.dunning_suspended' }),
      );
    });

    it('downgrades to free keeping the data when the plan asks for it', async () => {
      plan = {
        slug: 'pro',
        dunningGraceDays: 3,
        dunningEndAction: 'downgrade',
      };
      await service.onPaymentFailed('t1', invoice(1));
      const after = new Date(cases.get('in_1').graceEndsAt.getTime() + 1000);

      await service.sweep(after);

      expect(tenants.changePlan).toHaveBeenCalledWith('t1', 'free');
      expect(cancelCustomerSubscriptions).toHaveBeenCalledWith('cus_1');
      expect(lifecycle.restoreActive).toHaveBeenCalledWith('t1', {
        reason: 'dunning.downgraded',
      });
      expect(lifecycle.markSuspended).not.toHaveBeenCalled();
      expect(cases.get('in_1').status).toBe('DOWNGRADED');
    });

    it('reactivates a suspended tenant that finally pays', async () => {
      await service.onPaymentFailed('t1', invoice(1));
      await service.sweep(
        new Date(cases.get('in_1').graceEndsAt.getTime() + 1000),
      );
      await expect(
        service.onInvoicePaid('t1', { id: 'in_1' }),
      ).resolves.toEqual({ recovered: true });
      expect(cases.get('in_1').status).toBe('RECOVERED');
    });
  });

  it('exposes the delinquency list to platform admins only', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        (BillingController.prototype as any).dunningCases,
      ),
    ).toEqual(['PLATFORM_ADMIN']);
  });
});

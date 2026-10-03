const createBalanceTransaction = jest.fn();
jest.mock('stripe', () =>
  jest
    .fn()
    .mockImplementation(() => ({ customers: { createBalanceTransaction } })),
);

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import { BillingController } from './billing.controller';
import { CreditsService } from './credits.service';

describe('CreditsService (#95)', () => {
  const originalEnv = { ...process.env };
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: CreditsService;

  beforeEach(() => {
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: 'sk_live_real' };
    createBalanceTransaction.mockReset().mockResolvedValue({ id: 'cbtxn_1' });
    prisma = {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 't1', stripeId: 'cus_1' }),
      },
      creditLedgerEntry: {
        create: jest.fn(({ data }) =>
          Promise.resolve({ id: 'entry-new', ...data }),
        ),
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    audit = { record: jest.fn() };
    service = new CreditsService(prisma, audit as any);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('grant', () => {
    it('credits the Stripe customer (applied to the next invoices) and records the entry', async () => {
      const entry = await service.grant(
        't1',
        {
          amount: 5000,
          reason: 'Compensação por indisponibilidade',
          currency: 'BRL',
        },
        'admin-1',
      );

      expect(createBalanceTransaction).toHaveBeenCalledWith('cus_1', {
        amount: -5000,
        currency: 'brl',
        description: 'Crédito: Compensação por indisponibilidade',
      });
      expect(entry).toMatchObject({
        tenantId: 't1',
        kind: 'GRANT',
        amount: 5000,
        currency: 'brl',
        stripeBalanceTransactionId: 'cbtxn_1',
        createdBy: 'admin-1',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.credit_granted',
          resourceId: 't1',
        }),
      );
    });

    it('keeps the ledger without Stripe (dev key or no customer)', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      await expect(
        service.grant('t1', { amount: 100, reason: 'cortesia' }, 'admin-1'),
      ).resolves.toMatchObject({ stripeBalanceTransactionId: null });
      expect(createBalanceTransaction).not.toHaveBeenCalled();
    });

    it.each([
      [{ amount: 0, reason: 'ok ok' }],
      [{ amount: -10, reason: 'ok ok' }],
      [{ amount: 10.5, reason: 'ok ok' }],
      [{ amount: 20_000_000, reason: 'ok ok' }],
      [{ amount: 100, reason: '' }],
    ])('rejects %j', async (input) => {
      await expect(service.grant('t1', input, 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.creditLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.grant('nope', { amount: 100, reason: 'cortesia' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reverse', () => {
    const grant = {
      id: 'g1',
      tenantId: 't1',
      kind: 'GRANT',
      amount: 5000,
      currency: 'brl',
      stripeBalanceTransactionId: 'cbtxn_1',
    };

    it('adds a negative entry pointing to the grant and debits Stripe back', async () => {
      prisma.creditLedgerEntry.findFirst.mockResolvedValue(grant);
      const entry = await service.reverse(
        't1',
        'g1',
        { reason: 'Concedido por engano' },
        'admin-1',
      );

      expect(createBalanceTransaction).toHaveBeenCalledWith('cus_1', {
        amount: 5000,
        currency: 'brl',
        description: 'Estorno de crédito: Concedido por engano',
      });
      expect(entry).toMatchObject({
        kind: 'REVERSAL',
        amount: -5000,
        reversesId: 'g1',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.credit_reversed' }),
      );
    });

    it('reverses a grant only once and only inside the tenant', async () => {
      prisma.creditLedgerEntry.findFirst.mockResolvedValue(grant);
      prisma.creditLedgerEntry.findUnique.mockResolvedValue({ id: 'r0' });
      await expect(
        service.reverse('t1', 'g1', { reason: 'de novo' }, 'admin-1'),
      ).rejects.toThrow(ConflictException);

      prisma.creditLedgerEntry.findFirst.mockResolvedValue(null);
      await expect(
        service.reverse('t-other', 'g1', { reason: 'outro tenant' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.creditLedgerEntry.create).not.toHaveBeenCalled();
    });
  });

  it('computes the balance from the immutable ledger and flags reversed grants', async () => {
    prisma.creditLedgerEntry.findMany.mockResolvedValue([
      {
        id: 'r1',
        kind: 'REVERSAL',
        amount: -2000,
        currency: 'brl',
        reversesId: 'g2',
      },
      {
        id: 'g2',
        kind: 'GRANT',
        amount: 2000,
        currency: 'brl',
        reversesId: null,
      },
      {
        id: 'g1',
        kind: 'GRANT',
        amount: 5000,
        currency: 'brl',
        reversesId: null,
      },
      {
        id: 'g0',
        kind: 'GRANT',
        amount: 300,
        currency: 'usd',
        reversesId: null,
      },
    ]);

    const statement = await service.statement('t1');

    expect(statement.balance).toEqual({ brl: 5000, usd: 300 });
    expect(statement.entries.find((e) => e.id === 'g2')?.reversed).toBe(true);
    expect(statement.entries.find((e) => e.id === 'g1')?.reversed).toBe(false);
  });

  it('lets tenant billing roles read their statement and only platform admins move credit', () => {
    const roles = (m: string) =>
      Reflect.getMetadata(ROLES_KEY, (BillingController.prototype as any)[m]);
    expect(roles('creditStatement')).toEqual(['OWNER', 'ADMIN', 'BILLING']);
    expect(roles('grantCredit')).toEqual(['PLATFORM_ADMIN']);
    expect(roles('reverseCredit')).toEqual(['PLATFORM_ADMIN']);
    expect(roles('tenantCreditStatement')).toEqual(['PLATFORM_ADMIN']);
  });
});

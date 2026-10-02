const list = jest.fn();
const cancel = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({ subscriptions: { list, cancel } })),
);

import { cancelCustomerSubscriptions } from './stripe-subscriptions';

/** Imita a lista paginada do SDK (iterável assíncrona). */
const page = (items: { id: string; status: string }[]) => ({
  async *[Symbol.asyncIterator]() {
    yield* items;
  },
});

describe('cancelCustomerSubscriptions', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    list.mockReset();
    cancel.mockReset().mockResolvedValue({});
    process.env.STRIPE_SECRET_KEY = 'sk_live_real';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('cancels every subscription that can still be billed', async () => {
    list.mockReturnValue(
      page([
        { id: 'sub_active', status: 'active' },
        { id: 'sub_due', status: 'past_due' },
        { id: 'sub_trial', status: 'trialing' },
        { id: 'sub_done', status: 'canceled' },
        { id: 'sub_exp', status: 'incomplete_expired' },
      ]),
    );

    await expect(cancelCustomerSubscriptions('cus_1')).resolves.toEqual([
      'sub_active',
      'sub_due',
      'sub_trial',
    ]);
    expect(list).toHaveBeenCalledWith({
      customer: 'cus_1',
      status: 'all',
      limit: 100,
    });
    expect(cancel).toHaveBeenCalledTimes(3);
  });

  it('does nothing without a customer or with a dev key', async () => {
    await expect(cancelCustomerSubscriptions(null)).resolves.toEqual([]);
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    await expect(cancelCustomerSubscriptions('cus_1')).resolves.toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
});

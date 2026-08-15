import { NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';

describe('BillingService self-service', () => {
  const prisma: any = {
    tenant: { findUnique: jest.fn() },
    billingPlan: { findUnique: jest.fn() },
    microservice: { count: jest.fn().mockResolvedValue(2) },
    deployment: { count: jest.fn().mockResolvedValue(3) },
    user: { count: jest.fn().mockResolvedValue(4) },
    apiDoc: { count: jest.fn().mockResolvedValue(5) },
  };
  const entitlements = { resolve: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new BillingService(prisma, entitlements as any, audit as any);

  beforeEach(() => {
    jest.clearAllMocks();
    entitlements.resolve.mockResolvedValue({
      quotas: { MICROSERVICE: 10 },
      limits: { MICROSERVICE: 'hard' },
    });
  });

  it('returns plan price, status, entitlements and tenant-scoped usage', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      plan: 'Pro',
      state: 'past_due',
    });
    prisma.billingPlan.findUnique.mockResolvedValue({
      slug: 'pro',
      price: 4900,
      currency: 'brl',
      cycle: 'monthly',
    });

    const result = await service.getSubscription('tenant-1');

    expect(result).toMatchObject({
      plan: 'Pro',
      price: 4900,
      currency: 'brl',
      cycle: 'monthly',
      status: 'past_due',
      usage: { MICROSERVICE: 2, DEPLOYMENT: 3, SEATS: 4, APIS: 5 },
    });
  });

  it('rejects upgrade when the target plan does not exist', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      plan: 'Free',
    });
    prisma.billingPlan.findUnique.mockResolvedValue(null);

    await expect(
      service.createUpgradeSession('tenant-1', 'missing'),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not trust an external return URL and audits the upgrade request', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      plan: 'Free',
      stripeId: null,
    });
    prisma.billingPlan.findUnique.mockResolvedValue({
      slug: 'pro',
      status: 'active',
      stripePriceId: null,
    });

    const result = await service.createUpgradeSession(
      'tenant-1',
      'pro',
      'https://attacker.example/callback',
      'owner-1',
    );

    expect(result.url).toMatch(/^http:\/\/localhost:3000\/billing\?/);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'owner-1',
        action: 'billing.upgrade_requested',
        resourceId: 'tenant-1',
      }),
    );
  });
});

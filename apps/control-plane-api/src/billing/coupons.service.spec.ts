const couponsCreate = jest.fn();
const promotionCreate = jest.fn();
const promotionUpdate = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    coupons: { create: couponsCreate },
    promotionCodes: { create: promotionCreate, update: promotionUpdate },
  })),
);

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import { BillingController } from './billing.controller';
import { CouponsService } from './coupons.service';

describe('CouponsService (#95)', () => {
  const originalEnv = { ...process.env };
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: CouponsService;

  const coupon = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    code: 'LANCAMENTO20',
    percentOff: 20,
    amountOff: null,
    currency: 'usd',
    duration: 'once',
    durationInMonths: null,
    planSlugs: [],
    maxRedemptions: null,
    redeemedCount: 0,
    expiresAt: null,
    active: true,
    stripePromotionCodeId: 'promo_1',
    ...over,
  });

  beforeEach(() => {
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: 'sk_live_real' };
    couponsCreate.mockReset().mockResolvedValue({ id: 'co_1' });
    promotionCreate.mockReset().mockResolvedValue({ id: 'promo_1' });
    promotionUpdate.mockReset().mockResolvedValue({});
    prisma = {
      coupon: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(({ data }) => Promise.resolve({ id: 'c1', ...data })),
        update: jest.fn(({ data }) =>
          Promise.resolve({ ...coupon(), ...data }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      couponRedemption: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    audit = { record: jest.fn() };
    service = new CouponsService(prisma, audit as any);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('create', () => {
    it('creates the Stripe coupon and promotion code with the same code', async () => {
      const created = await service.create(
        {
          code: ' lancamento20 ',
          percentOff: 20,
          duration: 'repeating',
          durationInMonths: 3,
          planSlugs: ['PRO'],
          maxRedemptions: 100,
        },
        'admin-1',
      );

      expect(couponsCreate).toHaveBeenCalledWith({
        name: 'LANCAMENTO20',
        duration: 'repeating',
        duration_in_months: 3,
        percent_off: 20,
        max_redemptions: 100,
      });
      expect(promotionCreate).toHaveBeenCalledWith({
        promotion: { type: 'coupon', coupon: 'co_1' },
        code: 'LANCAMENTO20',
      });
      expect(created).toMatchObject({
        code: 'LANCAMENTO20',
        planSlugs: ['pro'],
        stripeCouponId: 'co_1',
        stripePromotionCodeId: 'promo_1',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.coupon_created' }),
      );
    });

    it('creates fixed-amount coupons in the given currency', async () => {
      await service.create(
        { code: 'MENOS10', amountOff: 1000, currency: 'BRL' },
        'admin-1',
      );
      expect(couponsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount_off: 1000, currency: 'brl' }),
      );
    });

    it.each([
      [{ code: 'x', percentOff: 10 }],
      [{ code: 'OK123' }],
      [{ code: 'OK123', percentOff: 10, amountOff: 100 }],
      [{ code: 'OK123', percentOff: 150 }],
      [{ code: 'OK123', amountOff: -5 }],
      [{ code: 'OK123', percentOff: 10, duration: 'weekly' }],
      [{ code: 'OK123', percentOff: 10, duration: 'repeating' }],
      [{ code: 'OK123', percentOff: 10, maxRedemptions: 0 }],
      [{ code: 'OK123', percentOff: 10, expiresAt: '2000-01-01' }],
    ])('rejects %j', async (input) => {
      await expect(service.create(input as any, 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(couponsCreate).not.toHaveBeenCalled();
    });

    it('rejects a duplicate code', async () => {
      prisma.coupon.findUnique.mockResolvedValue(coupon());
      await expect(
        service.create({ code: 'LANCAMENTO20', percentOff: 20 }, 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  it('deactivates the coupon here and in Stripe', async () => {
    prisma.coupon.findUnique.mockResolvedValue(coupon());
    await service.deactivate('lancamento20', 'admin-1');
    expect(promotionUpdate).toHaveBeenCalledWith('promo_1', { active: false });
    expect(prisma.coupon.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { active: false },
    });

    prisma.coupon.findUnique.mockResolvedValue(null);
    await expect(service.deactivate('NOPE', 'admin-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('findApplicable / validate', () => {
    it('returns the public discount of a valid coupon', async () => {
      prisma.coupon.findUnique.mockResolvedValue(
        coupon({ planSlugs: ['pro'] }),
      );
      await expect(service.validate('lancamento20', 'pro')).resolves.toEqual({
        code: 'LANCAMENTO20',
        percentOff: 20,
        amountOff: null,
        currency: 'usd',
        duration: 'once',
        durationInMonths: null,
      });
    });

    it.each([
      ['unknown', null, /não encontrado/],
      ['inactive', coupon({ active: false }), /desativado/],
      [
        'expired',
        coupon({ expiresAt: new Date(Date.now() - 1000) }),
        /expirado/,
      ],
      [
        'used up',
        coupon({ maxRedemptions: 5, redeemedCount: 5 }),
        /limite de usos/,
      ],
      [
        'out of scope',
        coupon({ planSlugs: ['enterprise'] }),
        /não vale para este plano/,
      ],
    ])('rejects a coupon that is %s', async (_label, found, message) => {
      prisma.coupon.findUnique.mockResolvedValue(found);
      await expect(service.findApplicable('X', 'pro')).rejects.toThrow(message);
    });
  });

  describe('redeem', () => {
    it('counts a use atomically within the limit and records it', async () => {
      prisma.coupon.findUnique.mockResolvedValue(
        coupon({ maxRedemptions: 10 }),
      );
      await expect(
        service.redeem('LANCAMENTO20', {
          tenantId: 't1',
          checkoutSessionId: 'cs_1',
        }),
      ).resolves.toEqual({ redeemed: true });

      expect(prisma.coupon.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', redeemedCount: { lt: 10 } },
        data: { redeemedCount: { increment: 1 } },
      });
      expect(prisma.couponRedemption.create).toHaveBeenCalledWith({
        data: { couponId: 'c1', tenantId: 't1', checkoutSessionId: 'cs_1' },
      });
    });

    it('does not count the same checkout twice nor beyond the limit', async () => {
      prisma.coupon.findUnique.mockResolvedValue(coupon({ maxRedemptions: 1 }));
      prisma.couponRedemption.findUnique.mockResolvedValueOnce({ id: 'r0' });
      await expect(
        service.redeem('LANCAMENTO20', { checkoutSessionId: 'cs_1' }),
      ).resolves.toEqual({ redeemed: false });

      prisma.coupon.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.redeem('LANCAMENTO20', { checkoutSessionId: 'cs_2' }),
      ).resolves.toEqual({ redeemed: false });
      expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
    });
  });

  it('only platform admins manage coupons', () => {
    const roles = (m: string) =>
      Reflect.getMetadata(ROLES_KEY, (BillingController.prototype as any)[m]);
    expect(roles('createCoupon')).toEqual(['PLATFORM_ADMIN']);
    expect(roles('listCoupons')).toEqual(['PLATFORM_ADMIN']);
    expect(roles('deactivateCoupon')).toEqual(['PLATFORM_ADMIN']);
  });
});

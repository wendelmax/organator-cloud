import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DEV_STRIPE_KEYS = ['sk_test_123', 'sk_test_placeholder', ''];
const MAX_CREDIT_CENTS = 10_000_000; // 100 mil na moeda

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});

const stripeEnabled = () =>
  !DEV_STRIPE_KEYS.includes(process.env.STRIPE_SECRET_KEY ?? '');

/**
 * Créditos de cortesia do tenant (#95). O ledger é imutável: conceder e
 * estornar só acrescentam lançamentos, e o saldo é a soma deles. Com cliente
 * no Stripe, cada lançamento vira uma transação de saldo do customer, que o
 * Stripe abate automaticamente das próximas faturas.
 */
@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async grant(
    tenantId: string,
    input: { amount?: number; reason?: string; currency?: string },
    actorId: string,
  ) {
    const amount = input.amount;
    const reason = (input.reason ?? '').trim();
    if (
      !Number.isInteger(amount) ||
      amount! <= 0 ||
      amount! > MAX_CREDIT_CENTS
    ) {
      throw new BadRequestException(
        `amount must be a positive integer in cents, up to ${MAX_CREDIT_CENTS}`,
      );
    }
    if (reason.length < 3) {
      throw new BadRequestException('A reason is required');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const currency = (input.currency || 'usd').toLowerCase();

    // Saldo negativo no Stripe = crédito do cliente, abatido das faturas.
    const stripeBalanceTransactionId =
      tenant.stripeId && stripeEnabled()
        ? (
            await stripe.customers.createBalanceTransaction(tenant.stripeId, {
              amount: -amount!,
              currency,
              description: `Crédito: ${reason}`.slice(0, 350),
            })
          ).id
        : null;

    const entry = await this.prisma.creditLedgerEntry.create({
      data: {
        tenantId,
        kind: 'GRANT',
        amount: amount!,
        currency,
        reason,
        stripeBalanceTransactionId,
        createdBy: actorId,
      },
    });
    await this.audit.record({
      actorId,
      action: 'billing.credit_granted',
      resourceType: 'Tenant',
      resourceId: tenantId,
      changes: {
        entryId: entry.id,
        amount,
        currency,
        reason,
        stripe: Boolean(stripeBalanceTransactionId),
      },
    });
    return entry;
  }

  /** Estorna uma concessão (uma vez só): novo lançamento negativo. */
  async reverse(
    tenantId: string,
    entryId: string,
    input: { reason?: string },
    actorId: string,
  ) {
    const reason = (input.reason ?? '').trim();
    if (reason.length < 3)
      throw new BadRequestException('A reason is required');
    const grant = await this.prisma.creditLedgerEntry.findFirst({
      where: { id: entryId, tenantId, kind: 'GRANT' },
    });
    if (!grant) throw new NotFoundException('Credit grant not found');
    const already = await this.prisma.creditLedgerEntry.findUnique({
      where: { reversesId: grant.id },
    });
    if (already)
      throw new ConflictException('This credit was already reversed');

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    // Se o crédito já foi consumido por faturas, o saldo positivo vira débito
    // na próxima fatura: o estorno é sempre integral e explícito.
    const stripeBalanceTransactionId =
      tenant?.stripeId && grant.stripeBalanceTransactionId && stripeEnabled()
        ? (
            await stripe.customers.createBalanceTransaction(tenant.stripeId, {
              amount: grant.amount,
              currency: grant.currency,
              description: `Estorno de crédito: ${reason}`.slice(0, 350),
            })
          ).id
        : null;

    const entry = await this.prisma.creditLedgerEntry.create({
      data: {
        tenantId,
        kind: 'REVERSAL',
        amount: -grant.amount,
        currency: grant.currency,
        reason,
        reversesId: grant.id,
        stripeBalanceTransactionId,
        createdBy: actorId,
      },
    });
    await this.audit.record({
      actorId,
      action: 'billing.credit_reversed',
      resourceType: 'Tenant',
      resourceId: tenantId,
      changes: {
        entryId: entry.id,
        reverses: grant.id,
        amount: grant.amount,
        reason,
      },
    });
    return entry;
  }

  /** Extrato e saldo por moeda (visível no billing do tenant). */
  async statement(tenantId: string) {
    const entries = await this.prisma.creditLedgerEntry.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        amount: true,
        currency: true,
        reason: true,
        reversesId: true,
        createdAt: true,
      },
    });
    const balance: Record<string, number> = {};
    for (const entry of entries) {
      balance[entry.currency] = (balance[entry.currency] ?? 0) + entry.amount;
    }
    const reversed = new Set(entries.map((e) => e.reversesId).filter(Boolean));
    return {
      balance,
      entries: entries.map((entry) => ({
        ...entry,
        reversed: entry.kind === 'GRANT' && reversed.has(entry.id),
      })),
    };
  }
}

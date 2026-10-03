import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { TenantLifecycleService } from '../tenants/tenant-lifecycle.service';
import { TenantsService } from '../tenants/tenants.service';
import { cancelCustomerSubscriptions } from './stripe-subscriptions';

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
/** Aviso de "graça acabando" quando faltam até 2 dias. */
const GRACE_WARNING_MS = 2 * DAY_MS;
const DEFAULT_GRACE_DAYS = () =>
  Number(process.env.TENANT_GRACE_PERIOD_DAYS) || 7;

type Stage = string; // failed:<n> | grace_ending | suspended | downgraded | recovered

const money = (cents: number, currency: string) =>
  `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
const date = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Inadimplência (#97). As retentativas de cobrança são do Stripe (Smart
 * Retries — refazê-las aqui cobraria em dobro); este serviço acompanha cada
 * fatura não paga, avisa o tenant em cada estágio e, no fim da graça, aplica a
 * política do plano: suspender ou rebaixar para o free preservando os dados.
 */
@Injectable()
export class DunningService implements OnModuleInit {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly lifecycle: TenantLifecycleService,
    private readonly tenants: TenantsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  /** `invoice.payment_failed`: abre (ou atualiza) o caso e entra em past_due. */
  async onPaymentFailed(tenantId: string, invoice: any) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    const plan = tenant
      ? await this.prisma.billingPlan.findUnique({
          where: { slug: tenant.plan.toLowerCase() },
        })
      : null;
    const graceDays = plan?.dunningGraceDays ?? DEFAULT_GRACE_DAYS();
    const attemptCount = Number(invoice.attempt_count) || 1;
    const nextAttemptAt = invoice.next_payment_attempt
      ? new Date(invoice.next_payment_attempt * 1000)
      : null;

    // O prazo de graça é fixado na 1ª falha da fatura; retentativas só
    // atualizam tentativas/próxima data (idempotente por invoiceId).
    const dunningCase = await this.prisma.dunningCase.upsert({
      where: { invoiceId: String(invoice.id) },
      create: {
        tenantId,
        invoiceId: String(invoice.id),
        amountDue: Number(invoice.amount_due) || 0,
        currency: String(invoice.currency || 'usd'),
        attemptCount,
        nextAttemptAt,
        graceEndsAt: new Date(Date.now() + graceDays * DAY_MS),
      },
      update: { attemptCount, nextAttemptAt },
    });
    if (dunningCase.status !== 'OPEN') return dunningCase;

    await this.lifecycle.enterPastDue(tenantId, {
      graceEndsAt: dunningCase.graceEndsAt,
      reason: 'invoice.payment_failed',
    });
    await this.notify(dunningCase, `failed:${attemptCount}`, {
      subject: 'Falha na cobrança da sua assinatura do Organator',
      text:
        `Não conseguimos cobrar a fatura de ${money(dunningCase.amountDue, dunningCase.currency)} (tentativa ${attemptCount}).\n\n` +
        (nextAttemptAt
          ? `Vamos tentar de novo em ${date(nextAttemptAt)}.\n`
          : '') +
        `Atualize o cartão no portal de cobrança até ${date(dunningCase.graceEndsAt)} para evitar a restrição da conta.\n`,
    });
    await this.audit.record({
      action: 'billing.dunning_payment_failed',
      resourceType: 'Tenant',
      resourceId: tenantId,
      changes: {
        invoiceId: dunningCase.invoiceId,
        attemptCount,
        graceEndsAt: dunningCase.graceEndsAt,
      },
    });
    return dunningCase;
  }

  /** `invoice.paid`: encerra o caso e reativa o tenant que estava restrito. */
  async onInvoicePaid(tenantId: string, invoice: any) {
    const dunningCase = await this.prisma.dunningCase.findUnique({
      where: { invoiceId: String(invoice.id) },
    });
    if (!dunningCase || !['OPEN', 'SUSPENDED'].includes(dunningCase.status)) {
      return null;
    }
    await this.prisma.dunningCase.update({
      where: { id: dunningCase.id },
      data: { status: 'RECOVERED', resolvedAt: new Date() },
    });
    await this.lifecycle.restoreActive(tenantId, { reason: 'invoice.paid' });
    await this.notify(dunningCase, 'recovered', {
      subject:
        'Pagamento confirmado — sua conta do Organator está regularizada',
      text: `Recebemos o pagamento de ${money(dunningCase.amountDue, dunningCase.currency)}. Obrigado! Sua conta voltou ao normal.\n`,
    });
    await this.audit.record({
      action: 'billing.dunning_recovered',
      resourceType: 'Tenant',
      resourceId: tenantId,
      changes: { invoiceId: dunningCase.invoiceId },
    });
    return { recovered: true };
  }

  /** Varredura periódica: aviso de graça acabando e ação final da política. */
  async sweep(now = new Date()) {
    const open = await this.prisma.dunningCase.findMany({
      where: {
        status: 'OPEN',
        graceEndsAt: { lt: new Date(now.getTime() + GRACE_WARNING_MS) },
      },
    });
    let actions = 0;
    for (const dunningCase of open) {
      try {
        if (dunningCase.graceEndsAt <= now) {
          if (await this.applyEndAction(dunningCase)) actions++;
        } else {
          await this.notify(dunningCase, 'grace_ending', {
            subject: 'Sua conta do Organator será restrita em breve',
            text: `A fatura de ${money(dunningCase.amountDue, dunningCase.currency)} continua em aberto. Regularize até ${date(dunningCase.graceEndsAt)} pelo portal de cobrança para evitar a restrição.\n`,
          });
        }
      } catch (err) {
        this.logger.warn(
          `Dunning sweep failed for ${dunningCase.id}: ${(err as Error).message}`,
        );
      }
    }
    return { checked: open.length, actions };
  }

  private async applyEndAction(dunningCase: {
    id: string;
    tenantId: string;
    invoiceId: string;
  }) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dunningCase.tenantId },
    });
    if (!tenant) return false;
    const plan = await this.prisma.billingPlan.findUnique({
      where: { slug: tenant.plan.toLowerCase() },
    });
    const action =
      plan?.dunningEndAction === 'downgrade' ? 'downgrade' : 'suspend';
    const status = action === 'downgrade' ? 'DOWNGRADED' : 'SUSPENDED';

    // Reivindica o caso antes de agir: duas varreduras não aplicam a ação duas vezes.
    const { count } = await this.prisma.dunningCase.updateMany({
      where: { id: dunningCase.id, status: 'OPEN' },
      data: { status, resolvedAt: action === 'downgrade' ? new Date() : null },
    });
    if (count === 0) return false;

    if (action === 'downgrade') {
      // Dados preservados: só o plano muda (a migração de isolamento é do worker).
      await this.tenants.changePlan(tenant.id, 'free');
      await cancelCustomerSubscriptions(tenant.stripeId).catch(() => []);
      await this.lifecycle.restoreActive(tenant.id, {
        reason: 'dunning.downgraded',
      });
      await this.notify(dunningCase, 'downgraded', {
        subject:
          'Sua assinatura do Organator foi alterada para o plano gratuito',
        text: 'Como a fatura não foi paga no prazo, sua organização passou para o plano gratuito. Seus dados foram preservados; você pode voltar a um plano pago quando quiser.\n',
      });
    } else {
      await this.lifecycle.markSuspended(tenant.id, {
        reason: 'dunning.grace_expired',
      });
      await this.notify(dunningCase, 'suspended', {
        subject: 'Sua conta do Organator foi suspensa por falta de pagamento',
        text: 'Como a fatura não foi paga no prazo, o acesso foi suspenso. Seus dados estão preservados: regularize o pagamento pelo portal de cobrança para reativar.\n',
      });
    }
    await this.audit.record({
      action: `billing.dunning_${action === 'downgrade' ? 'downgraded' : 'suspended'}`,
      resourceType: 'Tenant',
      resourceId: tenant.id,
      changes: { invoiceId: dunningCase.invoiceId, plan: tenant.plan },
    });
    return true;
  }

  /** Avisa OWNER/BILLING do tenant uma vez por estágio. */
  private async notify(
    dunningCase: { id: string; tenantId: string },
    stage: Stage,
    message: { subject: string; text: string },
  ) {
    const current = await this.prisma.dunningCase.findUnique({
      where: { id: dunningCase.id },
    });
    const sent = (current?.noticesSent as string[]) ?? [];
    if (sent.includes(stage)) return;
    await this.prisma.dunningCase.update({
      where: { id: dunningCase.id },
      data: { noticesSent: [...sent, stage] },
    });
    const recipients = await this.prisma.user.findMany({
      where: {
        OR: [
          {
            tenantId: dunningCase.tenantId,
            role: { in: ['OWNER', 'BILLING'] },
          },
          {
            memberships: {
              some: {
                tenantId: dunningCase.tenantId,
                role: { in: ['OWNER', 'BILLING'] },
                status: 'active',
              },
            },
          },
        ],
      },
      select: { email: true },
    });
    for (const { email } of recipients) {
      await this.mail
        .send({ to: email, ...message })
        .catch((err) =>
          this.logger.warn(
            `Dunning notice to ${email} failed: ${(err as Error).message}`,
          ),
        );
    }
  }

  /** Painel de inadimplência (admin da plataforma). */
  listCases(status?: string) {
    return this.prisma.dunningCase.findMany({
      where: status ? { status } : {},
      orderBy: { graceEndsAt: 'asc' },
      take: 200,
      include: {
        tenant: {
          select: { id: true, name: true, slug: true, plan: true, state: true },
        },
      },
    });
  }
}

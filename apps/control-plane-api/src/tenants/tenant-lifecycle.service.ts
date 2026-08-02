import {
  Injectable,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import {
  TenantState,
  TransitionOptions,
  VALID_STATES,
  TRANSITIONS,
  legacyStatusFor,
  BLOCKED_STATES,
  READ_ONLY_STATES,
} from './tenant-lifecycle.types';

const GRACE_PERIOD_DAYS = Number(process.env.TENANT_GRACE_PERIOD_DAYS) || 7;

@Injectable()
export class TenantLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
  ) {}

  /** Tempo de graça configurável (3–7 dias por padrão). */
  get gracePeriodMs(): number {
    return GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  }

  async getState(tenantId: string): Promise<TenantState> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { state: true, graceEndsAt: true },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    const state = this.normalizeState(tenant.state);
    // Graça expirada: past_due sem renovação vira suspensão.
    if (
      state === 'past_due' &&
      tenant.graceEndsAt &&
      tenant.graceEndsAt < new Date()
    ) {
      return 'suspended';
    }
    return state;
  }

  /**
   * Aplica uma transição de estado seguindo a máquina de estados.
   * Transição para o próprio estado é idempotente (reafirma sem falhar).
   * Ao mudar de estado: busta o cache de entitlements (#45) e registra
   * no audit log (#32).
   */
  async transition(
    tenantId: string,
    to: TenantState,
    opts: TransitionOptions = {},
  ): Promise<any> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (!VALID_STATES.includes(to)) {
      throw new BadRequestException(
        `Invalid state "${to}". Allowed: ${VALID_STATES.join(', ')}`,
      );
    }

    const from = this.normalizeState(tenant.state);
    if (from === to) {
      // Idempotência: eventos duplicados/recorrentes não podem falhar.
      this.entitlementsService.bust(tenantId);
      await this.auditService.record({
        actorId: opts.actorId ?? null,
        actorEmail: opts.actorEmail ?? null,
        action: 'tenant.state_reasserted',
        resourceType: 'Tenant',
        resourceId: tenantId,
        ip: opts.ip ?? null,
        changes: { state: to, reason: opts.reason ?? null },
      });
      return;
    }

    const allowed = TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Transição inválida: ${from} -> ${to}`);
    }

    const now = new Date();
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        state: to,
        stateChangedAt: now,
        status: legacyStatusFor(to),
        graceEndsAt:
          opts.graceEndsAt !== undefined
            ? opts.graceEndsAt
            : tenant.graceEndsAt,
        suspendedAt:
          opts.suspendedAt !== undefined
            ? opts.suspendedAt
            : tenant.suspendedAt,
      },
    });

    this.entitlementsService.bust(tenantId);

    await this.auditService.record({
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      action: 'tenant.state_change',
      resourceType: 'Tenant',
      resourceId: tenantId,
      ip: opts.ip ?? null,
      changes: {
        from,
        to,
        reason: opts.reason ?? null,
        graceEndsAt: opts.graceEndsAt ?? null,
      },
    });

    return updated;
  }

  /** Entra em past_due com período de graça (idempotente). */
  async enterPastDue(
    tenantId: string,
    opts: TransitionOptions = {},
  ): Promise<any> {
    const graceEndsAt = new Date(Date.now() + this.gracePeriodMs);
    return this.transition(tenantId, 'past_due', {
      ...opts,
      graceEndsAt,
      reason: 'invoice.payment_failed',
    });
  }

  /** Ativa/restaura o tenant após pagamento (idempotente). */
  async restoreActive(
    tenantId: string,
    opts: TransitionOptions = {},
  ): Promise<any> {
    return this.transition(tenantId, 'active', {
      ...opts,
      graceEndsAt: null,
      suspendedAt: null,
      reason: 'payment.succeeded',
    });
  }

  async markSuspended(
    tenantId: string,
    opts: TransitionOptions = {},
  ): Promise<any> {
    return this.transition(tenantId, 'suspended', {
      ...opts,
      suspendedAt: new Date(),
      reason: 'customer.subscription.deleted',
    });
  }

  async markOnboarding(
    tenantId: string,
    opts: TransitionOptions = {},
  ): Promise<any> {
    return this.transition(tenantId, 'onboarding', opts);
  }

  async markOffboarding(
    tenantId: string,
    opts: TransitionOptions = {},
  ): Promise<any> {
    return this.transition(tenantId, 'offboarding', opts);
  }

  async markDeleted(
    tenantId: string,
    opts: TransitionOptions = {},
  ): Promise<any> {
    return this.transition(tenantId, 'deleted', opts);
  }

  /**
   * Política de acesso para o guard de estado:
   * - suspenso/offboarding/deleted => acesso bloqueado
   * - past_due                     => leitura liberada, escrita bloqueada
   * - active/onboarding            => acesso total
   */
  async assertAccess(tenantId: string, method: string): Promise<void> {
    const state = await this.getState(tenantId);
    if (BLOCKED_STATES.includes(state)) {
      const code = state === 'deleted' ? 'TENANT_DELETED' : 'TENANT_SUSPENDED';
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          code,
          message: `Tenant ${state}. Acesso bloqueado: assinatura cancelada ou suspensa.`,
          state,
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (isWrite && READ_ONLY_STATES.includes(state)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          code: 'TENANT_PAST_DUE',
          message:
            'Tenant past_due: apenas leitura permitida durante o período de graça. ' +
            'Regularize o pagamento para voltar a usar o serviço.',
          state,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private normalizeState(state?: string | null): TenantState {
    return (VALID_STATES as string[]).includes(state || '')
      ? (state as TenantState)
      : 'active';
  }
}

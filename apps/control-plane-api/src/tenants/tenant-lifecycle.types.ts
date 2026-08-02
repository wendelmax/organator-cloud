/**
 * Máquina de estados do ciclo de vida do tenant dirigida por eventos de
 * pagamento (Issue #46).
 */
export type TenantState =
  | 'onboarding'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'offboarding'
  | 'deleted';

export const VALID_STATES: TenantState[] = [
  'onboarding',
  'active',
  'past_due',
  'suspended',
  'offboarding',
  'deleted',
];

/** Estados que permitem escrita completa (leitura + escrita). */
export const WRITABLE_STATES: TenantState[] = ['onboarding', 'active'];

/** Estados read-only (apenas leitura durante a graça). */
export const READ_ONLY_STATES: TenantState[] = ['past_due'];

/** Estados que bloqueiam o acesso por completo. */
export const BLOCKED_STATES: TenantState[] = [
  'suspended',
  'offboarding',
  'deleted',
];

/** Mapa de transições válidas: estado atual -> estados de destino permitidos. */
export const TRANSITIONS: Record<TenantState, TenantState[]> = {
  onboarding: ['active'],
  active: ['past_due', 'suspended', 'offboarding'],
  past_due: ['active', 'suspended', 'offboarding'],
  suspended: ['active', 'offboarding'],
  offboarding: ['deleted'],
  deleted: [],
};

/** Espelha o estado legado em `Tenant.status` (backward compat #34). */
export function legacyStatusFor(state: TenantState): string {
  switch (state) {
    case 'suspended':
      return 'suspended';
    case 'offboarding':
    case 'deleted':
      return 'archived';
    default:
      return 'active';
  }
}

export interface TransitionOptions {
  /** Motivo/evento que disparou a transição (auditoria). */
  reason?: string;
  /** Fim do período de graça (setar ao entrar em past_due). */
  graceEndsAt?: Date | null;
  /** Timestamp de suspensão (setar ao entrar em suspended). */
  suspendedAt?: Date | null;
  actorId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
}

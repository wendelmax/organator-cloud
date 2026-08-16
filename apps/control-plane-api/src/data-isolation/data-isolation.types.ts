export const DATA_ISOLATION_MODES = ['SHARED', 'SCHEMA', 'DATABASE'] as const;
export type DataIsolationModeValue = typeof DATA_ISOLATION_MODES[number];

export interface IsolationOverrideInput {
  mode: DataIsolationModeValue | null;
  confirmDestructive?: boolean;
}

export interface DataIsolationView {
  tenantId: string;
  desiredMode: DataIsolationModeValue;
  activeMode: DataIsolationModeValue | null;
  overridden: boolean;
  status: 'PENDING' | 'RECONCILING' | 'READY' | 'FAILED';
  phase: string;
  generation: number;
  observedGeneration: number;
  lastError: string | null;
  updatedAt: Date;
}

export function toDataIsolationView(tenant: any): DataIsolationView {
  const dp = tenant.dataPlane;
  return {
    tenantId: tenant.tenantId ?? tenant.id,
    desiredMode: tenant.dataIsolation,
    activeMode: dp?.activeIsolation ?? null,
    overridden: tenant.dataIsolationOverridden ?? false,
    status: dp?.status ?? 'PENDING',
    phase: dp?.phase ?? 'PREPARE',
    generation: dp?.generation ?? 1,
    observedGeneration: dp?.observedGeneration ?? 0,
    lastError: dp?.lastError ?? null,
    updatedAt: dp?.updatedAt ?? new Date(),
  };
}

export function planDefaultIsolation(plan: string): DataIsolationModeValue {
  switch (plan.toLowerCase()) {
    case 'enterprise': return 'DATABASE';
    case 'pro': return 'SCHEMA';
    default: return 'SHARED';
  }
}

export function isValidIsolationMode(mode: unknown): mode is DataIsolationModeValue {
  return typeof mode === 'string' && DATA_ISOLATION_MODES.includes(mode as DataIsolationModeValue);
}

import { DataIsolationMode } from './types.js';

export interface PlanResourceSpec {
  plan: string;
  isolationMode: DataIsolationMode;
  replicas: number;
  backupRetentionDays: number;
  allowCustomDomains: boolean;
  quotas: {
    maxUsers: number;
    maxStorageGb: number;
    maxApiRequestsPerMin: number;
  };
}

export type ReconcileAction =
  | { type: 'CHANGE_DATA_ISOLATION'; mode: DataIsolationMode }
  | { type: 'SCALE_REPLICAS'; count: number }
  | { type: 'ADJUST_BACKUP_RETENTION'; retentionDays: number }
  | { type: 'TOGGLE_CUSTOM_DOMAIN'; enabled: boolean };

export function resolvePlanSpec(planName: string): PlanResourceSpec {
  const normalized = (planName || 'Free').toLowerCase();
  switch (normalized) {
    case 'enterprise':
      return {
        plan: 'Enterprise',
        isolationMode: 'DATABASE',
        replicas: 3,
        backupRetentionDays: 30,
        allowCustomDomains: true,
        quotas: { maxUsers: 999999, maxStorageGb: 500, maxApiRequestsPerMin: 6000 },
      };
    case 'pro':
      return {
        plan: 'Pro',
        isolationMode: 'SCHEMA',
        replicas: 2,
        backupRetentionDays: 7,
        allowCustomDomains: true,
        quotas: { maxUsers: 50, maxStorageGb: 20, maxApiRequestsPerMin: 600 },
      };
    default:
      return {
        plan: 'Free',
        isolationMode: 'SHARED',
        replicas: 1,
        backupRetentionDays: 1,
        allowCustomDomains: false,
        quotas: { maxUsers: 5, maxStorageGb: 1, maxApiRequestsPerMin: 60 },
      };
  }
}

export function calculatePlanDiff(current: PlanResourceSpec, target: PlanResourceSpec): ReconcileAction[] {
  const actions: ReconcileAction[] = [];
  if (current.isolationMode !== target.isolationMode) {
    actions.push({ type: 'CHANGE_DATA_ISOLATION', mode: target.isolationMode });
  }
  if (current.replicas !== target.replicas) {
    actions.push({ type: 'SCALE_REPLICAS', count: target.replicas });
  }
  if (current.backupRetentionDays !== target.backupRetentionDays) {
    actions.push({ type: 'ADJUST_BACKUP_RETENTION', retentionDays: target.backupRetentionDays });
  }
  if (current.allowCustomDomains !== target.allowCustomDomains) {
    actions.push({ type: 'TOGGLE_CUSTOM_DOMAIN', enabled: target.allowCustomDomains });
  }
  return actions;
}

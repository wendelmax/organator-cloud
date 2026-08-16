export type HealthState = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export function evaluateHealthStatus(components: { db: HealthState; network: HealthState; dns: HealthState }): HealthState {
  if (components.db === 'DOWN' || components.network === 'DOWN' || components.dns === 'DOWN') {
    return 'DOWN';
  }
  if (components.db === 'DEGRADED' || components.network === 'DEGRADED' || components.dns === 'DEGRADED') {
    return 'DEGRADED';
  }
  return 'HEALTHY';
}

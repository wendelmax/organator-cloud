import { Registry, Counter, Histogram } from 'prom-client';

export const metricsRegistry = new Registry();

export const reconciliationsTotal = new Counter({
  name: 'organator_data_isolation_reconciliations_total',
  help: 'Total number of data isolation reconciliations',
  labelNames: ['source_mode', 'target_mode', 'result'],
  registers: [metricsRegistry],
});

export const phaseDurationSeconds = new Histogram({
  name: 'organator_data_isolation_phase_duration_seconds',
  help: 'Duration of data isolation phases in seconds',
  labelNames: ['phase', 'target_mode', 'result'],
  registers: [metricsRegistry],
});

export const retriesTotal = new Counter({
  name: 'organator_data_isolation_retries_total',
  help: 'Total number of data isolation retries',
  labelNames: ['phase', 'target_mode'],
  registers: [metricsRegistry],
});

export const compensationsTotal = new Counter({
  name: 'organator_data_isolation_compensations_total',
  help: 'Total number of target compensations executed',
  labelNames: ['stage', 'result'],
  registers: [metricsRegistry],
});

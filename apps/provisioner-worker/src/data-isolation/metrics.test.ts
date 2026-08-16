import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { metricsRegistry } from './metrics.js';

describe('Metrics', () => {
  test('labels do not contain sensitive identifiers', () => {
    const metrics = metricsRegistry.getMetricsAsArray();
    const banned = ['tenant', 'connection', 'password', 'resource_id'];
    
    for (const metric of metrics) {
      const labelNames = (metric as any).labelNames || [];
      for (const label of labelNames) {
        for (const bannedStr of banned) {
          assert.ok(!label.includes(bannedStr), `Label ${label} contains banned substring ${bannedStr}`);
        }
      }
    }
  });
});

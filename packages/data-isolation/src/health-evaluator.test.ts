import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHealthStatus } from './health-evaluator.js';

describe('health-evaluator', () => {
  test('returns HEALTHY when all components are healthy', () => {
    const status = evaluateHealthStatus({ db: 'HEALTHY', network: 'HEALTHY', dns: 'HEALTHY' });
    assert.equal(status, 'HEALTHY');
  });

  test('returns DEGRADED when any component is degraded', () => {
    const status = evaluateHealthStatus({ db: 'HEALTHY', network: 'DEGRADED', dns: 'HEALTHY' });
    assert.equal(status, 'DEGRADED');
  });

  test('returns DOWN when any component is down', () => {
    const status = evaluateHealthStatus({ db: 'DOWN', network: 'HEALTHY', dns: 'HEALTHY' });
    assert.equal(status, 'DOWN');
  });
});

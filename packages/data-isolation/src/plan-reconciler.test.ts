import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanSpec, calculatePlanDiff } from './plan-reconciler.js';

describe('plan-reconciler', () => {
  test('resolves Enterprise plan spec correctly', () => {
    const spec = resolvePlanSpec('Enterprise');
    assert.equal(spec.isolationMode, 'DATABASE');
    assert.equal(spec.replicas, 3);
  });

  test('calculates correct diff actions for Free -> Enterprise upgrade', () => {
    const free = resolvePlanSpec('Free');
    const enterprise = resolvePlanSpec('Enterprise');
    const diff = calculatePlanDiff(free, enterprise);

    assert.ok(diff.some((a) => a.type === 'CHANGE_DATA_ISOLATION' && a.mode === 'DATABASE'));
    assert.ok(diff.some((a) => a.type === 'SCALE_REPLICAS' && a.count === 3));
  });
});

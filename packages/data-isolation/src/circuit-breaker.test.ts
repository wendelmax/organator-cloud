import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuitState } from './circuit-breaker.js';

describe('circuit-breaker', () => {
  test('remains CLOSED when failure count is below threshold', () => {
    const res = evaluateCircuitState(3, 'CLOSED');
    assert.equal(res.state, 'CLOSED');
  });

  test('trips to OPEN when failure count reaches 5', () => {
    const res = evaluateCircuitState(5, 'CLOSED');
    assert.equal(res.state, 'OPEN');
  });
});

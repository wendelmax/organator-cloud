import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { providerSimulationEnabled } from './simulation.js';

describe('providerSimulationEnabled', () => {
  test('is explicit when PROVIDER_SIMULATION is set', () => {
    assert.equal(providerSimulationEnabled({ PROVIDER_SIMULATION: 'true', NODE_ENV: 'production' }), true);
    assert.equal(providerSimulationEnabled({ PROVIDER_SIMULATION: 'FALSE', NODE_ENV: 'development' }), false);
  });

  test('defaults to off in production and on elsewhere', () => {
    assert.equal(providerSimulationEnabled({ NODE_ENV: 'production' }), false);
    assert.equal(providerSimulationEnabled({ NODE_ENV: 'development' }), true);
    assert.equal(providerSimulationEnabled({}), true);
  });
});

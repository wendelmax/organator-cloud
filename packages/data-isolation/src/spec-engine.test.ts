import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateTenantSpec, calculateBackupChecksum } from './spec-engine.js';

describe('spec-engine', () => {
  test('validates valid tenant infra spec', () => {
    const spec = {
      specVersion: 'v1alpha1',
      databaseConfig: { isolationMode: 'SCHEMA', port: 5432 },
      networkConfig: { vpcId: 'vpc-1' },
      replicas: 2,
    };
    assert.equal(validateTenantSpec(spec), true);
  });

  test('generates valid SHA-256 checksum for backup payload', () => {
    const hash = calculateBackupChecksum('test-data-payload');
    assert.match(hash, /^[a-f0-9]{64}$/);
  });
});

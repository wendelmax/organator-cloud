import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '@organator/cloud-providers';
import { resolveDataPlaneConnection } from './connection-resolver.js';

const ref = { tenantId: 't1', generation: 4, referenceId: 'SCHEMA:t1:4' };
const url = 'postgresql://tenant_t1:pw@db:5432/organator';

function prismaWith(dataPlane: any) {
  return { tenantDataPlane: { findUnique: async () => dataPlane } } as any;
}

const ready = (overrides: Record<string, unknown> = {}) => ({
  status: 'READY',
  observedGeneration: 4,
  resourceState: { activeConnectionReference: 'SCHEMA:t1:4' },
  encryptedConnection: { url: encryptSecret(url) },
  ...overrides,
});

describe('resolveDataPlaneConnection', () => {
  test('decrypts the connection of a READY data plane with matching reference', async () => {
    assert.equal(await resolveDataPlaneConnection(prismaWith(ready()), ref), url);
  });

  const staleCases: [string, any, RegExp][] = [
    ['missing data plane', null, /not found/],
    ['not READY', ready({ status: 'RECONCILING' }), /not READY/],
    ['old generation', ready({ observedGeneration: 3 }), /Generation mismatch/],
    ['different reference', ready({ resourceState: { activeConnectionReference: 'SHARED:t1:3' } }), /reference mismatch/],
    ['no resource state', ready({ resourceState: null }), /reference mismatch/],
    ['missing payload', ready({ encryptedConnection: null }), /payload missing/],
    ['payload without url', ready({ encryptedConnection: {} }), /payload missing/],
  ];

  for (const [label, dataPlane, message] of staleCases) {
    test(`rejects as ISOLATION_CONNECTION_STALE: ${label}`, async () => {
      await assert.rejects(resolveDataPlaneConnection(prismaWith(dataPlane), ref), (err: any) => {
        assert.equal(err.code, 'ISOLATION_CONNECTION_STALE');
        assert.match(err.message, message);
        return true;
      });
    });
  }
});

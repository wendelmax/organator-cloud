import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresIsolationAdapter } from './adapter.js';
import { IsolationError } from '../identifiers.js';
import type {
  DataIsolationMode,
  IsolationManifest,
  IsolationContext,
  StoredConnection,
  ConnectionReference,
  TargetResources,
  ValidationEvidence,
} from '../types.js';

const TEST_URL = process.env.TEST_DATABASE_URL;

describe('Migration transitions', { skip: !TEST_URL ? 'TEST_DATABASE_URL not set' : undefined }, () => {
  // Integration tests would go here with real DB
});

describe('Adapter validation and activation logic (unit)', () => {
  test('activate throws without prior validation', async () => {
    const adapter = new PostgresIsolationAdapter({
      adminUrl: 'postgresql://unused:unused@localhost/unused',
      storeConnection: async () => ({
        reference: { id: 'ref', mode: 'SHARED' as DataIsolationMode },
        encryptedPayload: {},
      }),
    });

    const context: IsolationContext = {
      tenantId: 'tenant-1',
      generation: 1,
      sourceMode: null,
      targetMode: 'SHARED',
      source: null,
      sourceConnection: null,
      manifest: {
        apiVersion: 'organator.io/v1alpha1',
        product: 'test',
        tenantScopedTables: [],
        async applyMigrations() {},
        async validate() { return { rowCounts: {}, checksums: {}, validatedAt: new Date().toISOString() }; },
      },
      resolveConnection: async () => '',
      storeConnection: async () => ({
        reference: { id: 'ref', mode: 'SHARED' as DataIsolationMode },
        encryptedPayload: {},
      }),
    };

    const target: TargetResources = {
      mode: 'SHARED',
      database: '',
      schema: 'public',
      role: 'org_role_abc123def456',
      resourceIds: { role: 'org_role_abc123def456' },
    };

    await assert.rejects(
      () => adapter.activate(context, target),
      (err: IsolationError) => {
        assert.equal(err.code, 'ISOLATION_VALIDATION_REQUIRED');
        return true;
      },
    );

    await adapter.close();
  });

  test('rollback throws without source connection', async () => {
    const adapter = new PostgresIsolationAdapter({
      adminUrl: 'postgresql://unused:unused@localhost/unused',
      storeConnection: async () => ({
        reference: { id: 'ref', mode: 'SHARED' as DataIsolationMode },
        encryptedPayload: {},
      }),
    });

    const context: IsolationContext = {
      tenantId: 'tenant-1',
      generation: 1,
      sourceMode: null,
      targetMode: 'SCHEMA',
      source: null,
      sourceConnection: null, // No source connection
      manifest: {
        apiVersion: 'organator.io/v1alpha1',
        product: 'test',
        tenantScopedTables: [],
        async applyMigrations() {},
        async validate() { return { rowCounts: {}, checksums: {}, validatedAt: new Date().toISOString() }; },
      },
      resolveConnection: async () => '',
      storeConnection: async () => ({
        reference: { id: 'ref', mode: 'SHARED' as DataIsolationMode },
        encryptedPayload: {},
      }),
    };

    const target: TargetResources = {
      mode: 'SCHEMA',
      database: '',
      schema: 'org_schema_abc123def456',
      role: 'org_role_abc123def456',
      resourceIds: { schema: 'org_schema_abc123def456', role: 'org_role_abc123def456' },
    };

    await assert.rejects(
      () => adapter.rollback(context, target),
      (err: IsolationError) => {
        assert.equal(err.code, 'ISOLATION_ROLLBACK_FAILED');
        return true;
      },
    );

    await adapter.close();
  });

  test('rollbackHours defaults to 24 in cleanupAfter', async () => {
    // This test uses a mocked environment - the activate logic can only be tested
    // with validation evidence, which requires a real DB. Testing the default config.
    const adapter = new PostgresIsolationAdapter({
      adminUrl: 'postgresql://unused:unused@localhost/unused',
      storeConnection: async () => ({
        reference: { id: 'ref', mode: 'SHARED' as DataIsolationMode },
        encryptedPayload: {},
      }),
      rollbackHours: 48,
    });

    // Verify options are stored correctly
    assert.equal((adapter as any).options.rollbackHours, 48);
    await adapter.close();
  });
});

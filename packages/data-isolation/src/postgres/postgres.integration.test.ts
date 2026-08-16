import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresAdmin, quoteIdentifier } from './admin.js';
import { PostgresIsolationAdapter } from './adapter.js';
import { IsolationError } from '../identifiers.js';
import type { IsolationManifest, IsolationContext, StoredConnection } from '../types.js';

const TEST_URL = process.env.TEST_DATABASE_URL;

describe('quoteIdentifier', () => {
  test('accepts valid generated identifiers', () => {
    assert.equal(quoteIdentifier('org_role_0f5f1bc234c5'), '"org_role_0f5f1bc234c5"');
    assert.equal(quoteIdentifier('org_schema_abcdef012345'), '"org_schema_abcdef012345"');
    assert.equal(quoteIdentifier('org_db_112233445566'), '"org_db_112233445566"');
  });

  test('rejects arbitrary SQL identifiers', () => {
    assert.throws(() => quoteIdentifier('users'), { name: 'IsolationError' });
    assert.throws(() => quoteIdentifier('org_role_UPPER'), { name: 'IsolationError' });
    assert.throws(() => quoteIdentifier('" OR 1=1 --'), { name: 'IsolationError' });
    assert.throws(() => quoteIdentifier(''), { name: 'IsolationError' });
  });
});

describe('PostgresAdmin', { skip: !TEST_URL ? 'TEST_DATABASE_URL not set' : undefined }, () => {
  let admin: PostgresAdmin;

  before(() => {
    admin = new PostgresAdmin(TEST_URL!);
  });

  after(async () => {
    await admin?.close();
  });

  test('can query the database', async () => {
    const result = await admin.query<{ one: number }>('SELECT 1 AS one');
    assert.equal(result.rows[0].one, 1);
  });

  test('roleExists returns false for non-existent role', async () => {
    assert.equal(await admin.roleExists('org_role_nonexistent0'), false);
  });

  test('schemaExists returns true for public', async () => {
    assert.equal(await admin.schemaExists('public'), true);
  });

  test('databaseExists returns true for current db', async () => {
    const url = new URL(TEST_URL!);
    const dbName = url.pathname.slice(1);
    assert.equal(await admin.databaseExists(dbName), true);
  });
});

describe('PostgresIsolationAdapter', { skip: !TEST_URL ? 'TEST_DATABASE_URL not set' : undefined }, () => {
  let adapter: PostgresIsolationAdapter;
  const storedConnections: StoredConnection[] = [];

  const mockManifest: IsolationManifest = {
    apiVersion: 'organator.io/v1alpha1',
    product: 'test',
    tenantScopedTables: [],
    async applyMigrations() {},
    async validate() { return { rowCounts: {}, checksums: {}, validatedAt: new Date().toISOString() }; },
  };

  before(() => {
    adapter = new PostgresIsolationAdapter({
      adminUrl: TEST_URL!,
      storeConnection: async (input) => {
        const stored: StoredConnection = {
          reference: { id: `ref-${input.tenantId}`, mode: input.mode as any },
          encryptedPayload: { url: 'encrypted' },
        };
        storedConnections.push(stored);
        return stored;
      },
    });
  });

  after(async () => {
    await adapter?.close();
  });

  test('prepareTarget returns stable SCHEMA resources', async () => {
    const context: IsolationContext = {
      tenantId: 'test-tenant-schema-1',
      generation: 1,
      sourceMode: null,
      targetMode: 'SCHEMA',
      source: null,
      sourceConnection: null,
      manifest: mockManifest,
      resolveConnection: async () => '',
      storeConnection: async () => ({
        reference: { id: 'ref', mode: 'SCHEMA' as any },
        encryptedPayload: {},
      }),
    };

    const resources1 = await adapter.prepareTarget(context);
    assert.equal(resources1.mode, 'SCHEMA');
    assert.match(resources1.schema, /^org_schema_[a-f0-9]{12}$/);
    assert.match(resources1.role, /^org_role_[a-f0-9]{12}$/);

    // Second call returns same identifiers
    const resources2 = await adapter.prepareTarget(context);
    assert.equal(resources1.schema, resources2.schema);
    assert.equal(resources1.role, resources2.role);
  });

  test('prepareTarget returns stable DATABASE resources', async () => {
    const context: IsolationContext = {
      tenantId: 'test-tenant-db-1',
      generation: 1,
      sourceMode: null,
      targetMode: 'DATABASE',
      source: null,
      sourceConnection: null,
      manifest: mockManifest,
      resolveConnection: async () => '',
      storeConnection: async () => ({
        reference: { id: 'ref', mode: 'DATABASE' as any },
        encryptedPayload: {},
      }),
    };

    const resources1 = await adapter.prepareTarget(context);
    assert.equal(resources1.mode, 'DATABASE');
    assert.match(resources1.database, /^org_db_[a-f0-9]{12}$/);
    assert.match(resources1.role, /^org_role_[a-f0-9]{12}$/);
  });
});

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, DataIsolationConfigError, loadDataIsolationConfig } from './config.js';

const enabled = {
  DATA_ISOLATION_ENABLED: 'true',
  DATA_ISOLATION_ADMIN_URL: 'postgresql://admin:secret@dataplane:5432/tenants',
  DATA_ISOLATION_TABLES: '[{"table":"orders"}]',
};

describe('loadDataIsolationConfig', () => {
  test('is disabled unless explicitly enabled', () => {
    assert.deepEqual(loadDataIsolationConfig({}), { enabled: false });
    assert.deepEqual(loadDataIsolationConfig({ DATA_ISOLATION_ENABLED: '1' }), { enabled: false });
  });

  test('reads admin url, rollback window and tables with defaults', () => {
    assert.deepEqual(loadDataIsolationConfig({ ...enabled, DATA_ISOLATION_ROLLBACK_HOURS: '48' }), {
      enabled: true,
      adminUrl: 'postgresql://admin:secret@dataplane:5432/tenants',
      rollbackHours: 48,
      tables: [{ schema: 'public', table: 'orders', tenantColumn: 'tenant_id', primaryKey: 'id' }],
    });
    const cfg = loadDataIsolationConfig(enabled);
    assert.equal(cfg.enabled && cfg.rollbackHours, 24);
  });

  test('accepts custom schema, tenant column and primary key', () => {
    const cfg = loadDataIsolationConfig({
      ...enabled,
      DATA_ISOLATION_TABLES: '[{"schema":"app","table":"invoices","tenantColumn":"account_id","primaryKey":"invoice_id"}]',
    });
    assert.deepEqual(cfg.enabled && cfg.tables, [
      { schema: 'app', table: 'invoices', tenantColumn: 'account_id', primaryKey: 'invoice_id' },
    ]);
  });

  const invalid: [string, Record<string, string>, RegExp][] = [
    ['missing admin url', { ...enabled, DATA_ISOLATION_ADMIN_URL: '' }, /DATA_ISOLATION_ADMIN_URL is required/],
    ['non-postgres admin url', { ...enabled, DATA_ISOLATION_ADMIN_URL: 'mysql://x' }, /postgresql:\/\//],
    ['bad rollback window', { ...enabled, DATA_ISOLATION_ROLLBACK_HOURS: '0' }, /ROLLBACK_HOURS/],
    ['missing tables', { ...enabled, DATA_ISOLATION_TABLES: '' }, /DATA_ISOLATION_TABLES is required/],
    ['invalid JSON', { ...enabled, DATA_ISOLATION_TABLES: '[{' }, /valid JSON/],
    ['empty list', { ...enabled, DATA_ISOLATION_TABLES: '[]' }, /non-empty/],
    ['SQL injection in a name', { ...enabled, DATA_ISOLATION_TABLES: '[{"table":"orders; DROP TABLE x"}]' }, /\.table must be a valid SQL identifier/],
    ['missing table name', { ...enabled, DATA_ISOLATION_TABLES: '[{"tenantColumn":"t"}]' }, /\.table must be/],
    ['duplicated table', { ...enabled, DATA_ISOLATION_TABLES: '[{"table":"a"},{"table":"a"}]' }, /more than once/],
  ];
  for (const [label, env, message] of invalid) {
    test(`rejects ${label}`, () => {
      assert.throws(() => loadDataIsolationConfig(env), (err: Error) => err instanceof DataIsolationConfigError && message.test(err.message));
    });
  }
});

test('buildManifest clones the shared structure into isolated targets', () => {
  const manifest = buildManifest([{ schema: 'public', table: 'orders', tenantColumn: 'tenant_id', primaryKey: 'id' }]);
  assert.equal(manifest.structure, 'clone-shared');
  assert.equal(manifest.tenantScopedTables.length, 1);
});

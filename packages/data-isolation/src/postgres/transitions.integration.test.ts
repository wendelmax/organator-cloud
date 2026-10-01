import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresAdmin } from './admin.js';
import { PostgresIsolationAdapter } from './adapter.js';
import { makeTenantIdentifier, tenantRoleName } from '../identifiers.js';
import type {
  ConnectionReference,
  DataIsolationMode,
  IsolationContext,
  IsolationManifest,
  TargetResources,
} from '../types.js';

const TEST_URL = process.env.TEST_DATABASE_URL;

/**
 * Fluxo completo de migração entre modos de isolamento contra um PostgreSQL
 * real: SHARED -> SCHEMA -> DATABASE, com dados de dois tenants na tabela
 * compartilhada. Verifica que apenas os dados do tenant migram, que a conexão
 * ativada usa as credenciais do tenant (não as de admin) e que essas
 * credenciais não alcançam dados de outros tenants.
 */
describe('Isolation transitions (integration)', { skip: !TEST_URL ? 'TEST_DATABASE_URL not set' : undefined }, () => {
  const tenantA = 'transition-tenant-a';
  const tenantB = 'transition-tenant-b';
  const schemaA = makeTenantIdentifier('schema', tenantA);
  const dbA = makeTenantIdentifier('db', tenantA);
  const schemaRole = tenantRoleName(tenantA, 'SCHEMA');
  const dbRole = tenantRoleName(tenantA, 'DATABASE');
  let schemaUrl = '';
  let databaseUrl = '';

  let admin: PostgresAdmin;
  let adapter: PostgresIsolationAdapter;
  const stored: Record<string, string> = {};

  const sharedSource: TargetResources = {
    mode: 'SHARED',
    database: '',
    schema: 'public',
    role: '',
    resourceIds: {},
  };
  let schemaTarget: TargetResources;
  let databaseTarget: TargetResources;

  const tenantDbUrl = () => {
    const url = new URL(TEST_URL!);
    url.pathname = `/${dbA}`;
    return url.toString();
  };

  const manifest: IsolationManifest = {
    apiVersion: 'organator.io/v1alpha1',
    product: 'transition-test',
    tenantScopedTables: [{ schema: 'public', table: 'orders', tenantColumn: 'tenant_id', primaryKey: 'id' }],
    async applyMigrations(ref: ConnectionReference) {
      const ddl = 'CREATE TABLE IF NOT EXISTS %s (id text PRIMARY KEY, tenant_id text NOT NULL, total integer NOT NULL)';
      if (ref.mode === 'SCHEMA') {
        await admin.query(ddl.replace('%s', `"${schemaA}"."orders"`));
      } else if (ref.mode === 'DATABASE') {
        const client = new pg.Client({ connectionString: tenantDbUrl() });
        await client.connect();
        try {
          await client.query(ddl.replace('%s', 'public.orders'));
        } finally {
          await client.end();
        }
      }
    },
    async validate() {
      return { rowCounts: {}, checksums: {}, validatedAt: new Date().toISOString() };
    },
  };

  const context = (
    sourceMode: DataIsolationMode,
    source: TargetResources,
    targetMode: DataIsolationMode,
  ): IsolationContext => ({
    tenantId: tenantA,
    generation: 1,
    sourceMode,
    targetMode,
    source,
    sourceConnection: { id: `${sourceMode}:${tenantA}`, mode: sourceMode },
    manifest,
    resolveConnection: async () => '',
    storeConnection: async (input) => {
      stored[input.mode] = input.url;
      return { reference: { id: `${input.mode}:${input.tenantId}`, mode: input.mode }, encryptedPayload: { url: input.url } };
    },
  });

  async function queryAs<T extends pg.QueryResultRow>(url: string, sql: string): Promise<T[]> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return (await client.query<T>(sql)).rows;
    } finally {
      await client.end();
    }
  }

  async function dropTenantResources() {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaA}" CASCADE`);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbA],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${dbA}"`);
    await admin.query(`DROP TABLE IF EXISTS public.orders`);
    const sharedRoleB = tenantRoleName(tenantB, 'SHARED');
    if (await admin.schemaExists('organator_guard')) {
      await admin.query('DELETE FROM organator_guard.tenant_roles WHERE role_name = $1', [sharedRoleB]);
    }
    for (const role of [schemaRole, dbRole, sharedRoleB]) {
      const exists = await admin.query<{ exists: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
        [role],
      );
      if (exists.rows[0].exists) {
        await admin.query(`DROP OWNED BY "${role}" CASCADE`);
        await admin.query(`DROP ROLE "${role}"`);
      }
    }
  }

  before(async () => {
    admin = new PostgresAdmin(TEST_URL!);
    adapter = new PostgresIsolationAdapter({ adminUrl: TEST_URL!, storeConnection: context('SHARED', sharedSource, 'SHARED').storeConnection });
    await dropTenantResources();
    await admin.query('CREATE TABLE public.orders (id text PRIMARY KEY, tenant_id text NOT NULL, total integer NOT NULL)');
    await admin.query(
      `INSERT INTO public.orders (id, tenant_id, total) VALUES
        ('a1', $1, 10), ('a2', $1, 20), ('a3', $1, 30), ('b1', $2, 99), ('b2', $2, 98)`,
      [tenantA, tenantB],
    );
  });

  after(async () => {
    await adapter.close();
    await dropTenantResources();
    await admin.close();
  });

  test('SHARED -> SCHEMA copies only the tenant rows', async () => {
    const ctx = context('SHARED', sharedSource, 'SCHEMA');
    schemaTarget = await adapter.prepareTarget(ctx);
    await adapter.applyMigrations(ctx, schemaTarget);

    const copy = await adapter.copyData(ctx, schemaTarget);
    assert.deepEqual(copy.rowCounts, { orders: 3 });

    const rows = await admin.query<{ id: string }>(`SELECT id FROM "${schemaA}".orders ORDER BY id`);
    assert.deepEqual(rows.rows.map((r) => r.id), ['a1', 'a2', 'a3']);

    const evidence = await adapter.validate(ctx, schemaTarget);
    assert.deepEqual(evidence.rowCounts, { orders: 3 });
  });

  test('SCHEMA activation hands out tenant credentials scoped to the schema', async () => {
    const activation = await adapter.activate(context('SHARED', sharedSource, 'SCHEMA'), schemaTarget);
    const url = new URL((activation.storedConnection.encryptedPayload as { url: string }).url);

    assert.equal(url.username, schemaRole, 'activated connection must not use the admin role');
    schemaUrl = url.toString();
    const own = await queryAs<{ id: string }>(url.toString(), 'SELECT id FROM orders ORDER BY id');
    assert.deepEqual(own.map((r) => r.id), ['a1', 'a2', 'a3']);
    await assert.rejects(queryAs(url.toString(), 'SELECT * FROM public.orders'), /permission denied/);
  });

  test('SCHEMA -> DATABASE copies the tenant schema into a dedicated database', async () => {
    const ctx = context('SCHEMA', schemaTarget, 'DATABASE');
    databaseTarget = await adapter.prepareTarget(ctx);
    // Preparar o destino não pode invalidar a conexão ativa (origem).
    const stillServing = await queryAs<{ id: string }>(schemaUrl, 'SELECT id FROM orders ORDER BY id');
    assert.equal(stillServing.length, 3);
    await adapter.applyMigrations(ctx, databaseTarget);

    const copy = await adapter.copyData(ctx, databaseTarget);
    assert.deepEqual(copy.rowCounts, { orders: 3 });

    const evidence = await adapter.validate(ctx, databaseTarget);
    assert.deepEqual(evidence.rowCounts, { orders: 3 });

    const rows = await queryAs<{ id: string; tenant_id: string }>(tenantDbUrl(), 'SELECT id, tenant_id FROM public.orders ORDER BY id');
    assert.deepEqual(rows.map((r) => r.id), ['a1', 'a2', 'a3']);
    assert.ok(rows.every((r) => r.tenant_id === tenantA));
  });

  test('DATABASE activation hands out tenant credentials for the tenant database', async () => {
    const activation = await adapter.activate(context('SCHEMA', schemaTarget, 'DATABASE'), databaseTarget);
    const url = new URL((activation.storedConnection.encryptedPayload as { url: string }).url);

    assert.equal(url.username, dbRole);
    assert.notEqual(dbRole, schemaRole);
    assert.equal(url.pathname, `/${dbA}`);
    databaseUrl = url.toString();
    const own = await queryAs<{ total: number }>(url.toString(), 'SELECT total FROM public.orders ORDER BY id');
    assert.deepEqual(own.map((r) => r.total), [10, 20, 30]);
  });

  test('validate detects rows missing from the target', async () => {
    const client = new pg.Client({ connectionString: tenantDbUrl() });
    await client.connect();
    await client.query(`DELETE FROM public.orders WHERE id = 'a3'`);
    await client.end();

    await assert.rejects(
      adapter.validate(context('SCHEMA', schemaTarget, 'DATABASE'), databaseTarget),
      (err: { code?: string }) => err.code === 'ISOLATION_VALIDATION_FAILED',
    );
  });

  test('cleanupSource for SHARED deletes only the migrated tenant rows', async () => {
    await adapter.cleanupSource(context('SHARED', sharedSource, 'SCHEMA'), sharedSource);
    const rows = await admin.query<{ id: string }>('SELECT id FROM public.orders ORDER BY id');
    assert.deepEqual(rows.rows.map((r) => r.id), ['b1', 'b2']);
  });

  test('cleanupSource for SCHEMA drops the old schema and role but keeps the active database usable', async () => {
    await adapter.cleanupSource(context('SCHEMA', schemaTarget, 'DATABASE'), schemaTarget);
    assert.equal(await admin.schemaExists(schemaA), false);
    assert.equal(await admin.roleExists(schemaRole), false);
    await assert.rejects(queryAs(schemaUrl, 'SELECT 1'));

    const rows = await queryAs<{ id: string }>(databaseUrl, 'SELECT id FROM public.orders ORDER BY id');
    assert.deepEqual(rows.map((r) => r.id), ['a1', 'a2']);
  });

  test('SHARED target enforces row-level security for the tenant role', async () => {
    const ctxB: IsolationContext = { ...context('SHARED', sharedSource, 'SHARED'), tenantId: tenantB, source: null, sourceMode: null };
    await adapter.prepareTarget(ctxB);
    const url = new URL(stored.SHARED);
    assert.equal(url.username, tenantRoleName(tenantB, 'SHARED'));

    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      // Sem app.tenant_id a política não libera nenhuma linha.
      assert.equal((await client.query('SELECT id FROM public.orders')).rowCount, 0);
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      const own = await client.query<{ id: string }>('SELECT id FROM public.orders ORDER BY id');
      assert.deepEqual(own.rows.map((r) => r.id), ['b1', 'b2']);
      await client.query('COMMIT');

      // Outro tenant no contexto não expõe dados (a política exige o role mapeado).
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      assert.equal((await client.query('SELECT id FROM public.orders')).rowCount, 0);
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  });

  test('compensate drops the dedicated database and its role', async () => {
    await adapter.compensate(context('SCHEMA', schemaTarget, 'DATABASE'), databaseTarget);
    assert.equal(await admin.databaseExists(dbA), false);
    assert.equal(await admin.roleExists(dbRole), false);
  });
});

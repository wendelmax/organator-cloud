import { PostgresAdmin, quoteIdentifier } from './admin.js';
import { IsolationError } from '../identifiers.js';
import type { TenantScopedTable, TargetResources, ConnectionReference, StoredConnection } from '../types.js';

export interface SharedProvisionResult {
  role: string;
  resources: TargetResources;
}

export async function provisionSharedIsolation(
  admin: PostgresAdmin,
  tenantId: string,
  role: string,
  tables: TenantScopedTable[],
  storeConnection: (input: { tenantId: string; mode: 'SHARED'; url: string }) => Promise<StoredConnection>,
  adminUrl: string,
): Promise<SharedProvisionResult> {
  // 1. Create the guard schema and mapping table
  await admin.query(`CREATE SCHEMA IF NOT EXISTS organator_guard`);
  await admin.query(`REVOKE ALL ON SCHEMA organator_guard FROM PUBLIC`);
  await admin.query(`
    CREATE TABLE IF NOT EXISTS organator_guard.tenant_roles (
      role_name name PRIMARY KEY,
      tenant_id text NOT NULL UNIQUE
    )
  `);

  // 2. Create SECURITY DEFINER function for role-to-tenant mapping
  await admin.query(`
    CREATE OR REPLACE FUNCTION organator_guard.tenant_for_role(role_name name)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      SELECT tenant_id FROM organator_guard.tenant_roles WHERE role_name = $1
    $$
  `);

  // 3. Create the tenant role (if not exists)
  const safeRole = quoteIdentifier(role);
  if (!(await admin.roleExists(role))) {
    // Generate a secure password using PostgreSQL format() for safety
    const { randomBytes } = await import('node:crypto');
    const password = randomBytes(32).toString('base64url');
    const formatted = await admin.query<{ stmt: string }>(
      `SELECT format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1, $2) AS stmt`,
      [role, password],
    );
    await admin.query(formatted.rows[0].stmt);

    // Store the connection (plaintext only passes through the callback)
    const connUrl = new URL(adminUrl);
    connUrl.username = role;
    connUrl.password = password;
    await storeConnection({ tenantId, mode: 'SHARED', url: connUrl.toString() });
  }

  // 4. Register role-to-tenant mapping
  await admin.query(
    `INSERT INTO organator_guard.tenant_roles (role_name, tenant_id) VALUES ($1, $2) ON CONFLICT (role_name) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`,
    [role, tenantId],
  );

  // 5. For each manifest table, verify columns and apply RLS
  for (const table of tables) {
    // Verify tenantColumn exists
    const colCheck = await admin.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3) AS exists`,
      [table.schema, table.table, table.tenantColumn],
    );
    if (!colCheck.rows[0].exists) {
      throw new IsolationError(
        'ISOLATION_SCHEMA_MISMATCH',
        `Column ${table.tenantColumn} not found in ${table.schema}.${table.table}`,
      );
    }

    // Verify primaryKey exists
    const pkCheck = await admin.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3) AS exists`,
      [table.schema, table.table, table.primaryKey],
    );
    if (!pkCheck.rows[0].exists) {
      throw new IsolationError(
        'ISOLATION_SCHEMA_MISMATCH',
        `Primary key column ${table.primaryKey} not found in ${table.schema}.${table.table}`,
      );
    }

    const qualifiedTable = `"${table.schema}"."${table.table}"`;

    // Enable and force RLS
    await admin.query(`ALTER TABLE ${qualifiedTable} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE ${qualifiedTable} FORCE ROW LEVEL SECURITY`);

    // Create the policy
    const policyName = `org_tenant_isolation_${table.table}`;
    await admin.query(`DROP POLICY IF EXISTS "${policyName}" ON ${qualifiedTable}`);
    await admin.query(`
      CREATE POLICY "${policyName}" ON ${qualifiedTable}
      FOR ALL
      USING (
        ${table.tenantColumn} = organator_guard.tenant_for_role(session_user)
        AND ${table.tenantColumn} = current_setting('app.tenant_id', true)
      )
      WITH CHECK (
        ${table.tenantColumn} = organator_guard.tenant_for_role(session_user)
        AND ${table.tenantColumn} = current_setting('app.tenant_id', true)
      )
    `);

    // Grant privileges to tenant role
    await admin.query(`GRANT USAGE ON SCHEMA "${table.schema}" TO ${safeRole}`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${qualifiedTable} TO ${safeRole}`);
  }

  // Grant usage on sequences
  await admin.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA "public" TO ${safeRole}`);

  return {
    role,
    resources: {
      mode: 'SHARED',
      database: '',
      schema: 'public',
      role,
      resourceIds: { role },
    },
  };
}

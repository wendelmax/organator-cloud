import { PostgresAdmin, quoteIdentifier } from './admin.js';
import { IsolationError } from '../identifiers.js';
import type { DataIsolationMode, TargetResources, StoredConnection } from '../types.js';
import { randomBytes } from 'node:crypto';

export async function provisionSchemaIsolation(
  admin: PostgresAdmin,
  tenantId: string,
  schemaName: string,
  roleName: string,
  storeConnection: (input: { tenantId: string; mode: DataIsolationMode; url: string }) => Promise<StoredConnection>,
  adminUrl: string,
): Promise<TargetResources> {
  const safeSchema = quoteIdentifier(schemaName);
  const safeRole = quoteIdentifier(roleName);

  // Create schema if not exists
  if (!(await admin.schemaExists(schemaName))) {
    await admin.query(`CREATE SCHEMA ${safeSchema}`);
  }

  // Create role if not exists
  if (!(await admin.roleExists(roleName))) {
    const password = randomBytes(32).toString('base64url');
    const formatted = await admin.query<{ stmt: string }>(
      `SELECT format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1, $2) AS stmt`,
      [roleName, password],
    );
    await admin.query(formatted.rows[0].stmt);

    const connUrl = new URL(adminUrl);
    connUrl.username = roleName;
    connUrl.password = password;
    connUrl.searchParams.set('options', `-c search_path=${schemaName}`);
    await storeConnection({ tenantId, mode: 'SCHEMA', url: connUrl.toString() });
  }

  // Revoke public, grant only tenant schema
  await admin.query(`REVOKE ALL ON SCHEMA "public" FROM ${safeRole}`);
  await admin.query(`GRANT ALL ON SCHEMA ${safeSchema} TO ${safeRole}`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${safeSchema} GRANT ALL ON TABLES TO ${safeRole}`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${safeSchema} GRANT USAGE ON SEQUENCES TO ${safeRole}`);

  return {
    mode: 'SCHEMA',
    database: '',
    schema: schemaName,
    role: roleName,
    resourceIds: { schema: schemaName, role: roleName },
  };
}

export async function provisionDatabaseIsolation(
  admin: PostgresAdmin,
  tenantId: string,
  dbName: string,
  roleName: string,
  storeConnection: (input: { tenantId: string; mode: DataIsolationMode; url: string }) => Promise<StoredConnection>,
  adminUrl: string,
): Promise<TargetResources> {
  // Create role if not exists
  if (!(await admin.roleExists(roleName))) {
    const password = randomBytes(32).toString('base64url');
    const formatted = await admin.query<{ stmt: string }>(
      `SELECT format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1, $2) AS stmt`,
      [roleName, password],
    );
    await admin.query(formatted.rows[0].stmt);

    // Build connection URL for tenant database
    const connUrl = new URL(adminUrl);
    connUrl.username = roleName;
    connUrl.password = password;
    connUrl.pathname = `/${dbName}`;
    await storeConnection({ tenantId, mode: 'DATABASE', url: connUrl.toString() });
  }

  // Create database if not exists, owned by admin
  if (!(await admin.databaseExists(dbName))) {
    const formatted = await admin.query<{ stmt: string }>(
      `SELECT format('CREATE DATABASE %I', $1) AS stmt`,
      [dbName],
    );
    await admin.query(formatted.rows[0].stmt);
  }

  // Revoke public connect, grant only to tenant role and admin
  const fmtRevoke = await admin.query<{ stmt: string }>(
    `SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', $1) AS stmt`,
    [dbName],
  );
  await admin.query(fmtRevoke.rows[0].stmt);

  const fmtGrant = await admin.query<{ stmt: string }>(
    `SELECT format('GRANT CONNECT ON DATABASE %I TO %I', $1, $2) AS stmt`,
    [dbName, roleName],
  );
  await admin.query(fmtGrant.rows[0].stmt);

  return {
    mode: 'DATABASE',
    database: dbName,
    schema: 'public',
    role: roleName,
    resourceIds: { database: dbName, role: roleName },
  };
}

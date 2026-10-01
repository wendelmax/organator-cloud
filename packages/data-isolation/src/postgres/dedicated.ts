import { PostgresAdmin, quoteIdentifier } from './admin.js';
import type { DataIsolationMode, TargetResources, StoredConnection } from '../types.js';

type StoreConnection = (input: { tenantId: string; mode: DataIsolationMode; url: string }) => Promise<StoredConnection>;

export interface ProvisionResult {
  resources: TargetResources;
  /** Conexão do tenant (credenciais do role do tenant, nunca as de admin). */
  connection: StoredConnection;
}

export async function provisionSchemaIsolation(
  admin: PostgresAdmin,
  tenantId: string,
  schemaName: string,
  roleName: string,
  storeConnection: StoreConnection,
): Promise<ProvisionResult> {
  const safeSchema = quoteIdentifier(schemaName);
  const safeRole = quoteIdentifier(roleName);

  if (!(await admin.schemaExists(schemaName))) {
    await admin.query(`CREATE SCHEMA ${safeSchema}`);
  }
  const password = await admin.ensureLoginRole(roleName);

  // Acesso apenas ao schema do tenant; tabelas criadas depois (migrações do
  // produto, executadas pelo admin) herdam os privilégios por default.
  await admin.query(`REVOKE ALL ON SCHEMA "public" FROM ${safeRole}`);
  await admin.query(`GRANT ALL ON SCHEMA ${safeSchema} TO ${safeRole}`);
  await admin.query(`GRANT ALL ON ALL TABLES IN SCHEMA ${safeSchema} TO ${safeRole}`);
  await admin.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${safeSchema} TO ${safeRole}`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${safeSchema} GRANT ALL ON TABLES TO ${safeRole}`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${safeSchema} GRANT USAGE ON SEQUENCES TO ${safeRole}`);

  const connection = await storeConnection({
    tenantId,
    mode: 'SCHEMA',
    url: admin.tenantUrl(roleName, password, { searchPath: schemaName }),
  });

  return {
    resources: {
      mode: 'SCHEMA',
      database: '',
      schema: schemaName,
      role: roleName,
      resourceIds: { schema: schemaName, role: roleName },
    },
    connection,
  };
}

export async function provisionDatabaseIsolation(
  admin: PostgresAdmin,
  tenantId: string,
  dbName: string,
  roleName: string,
  storeConnection: StoreConnection,
): Promise<ProvisionResult> {
  const safeRole = quoteIdentifier(roleName);
  const password = await admin.ensureLoginRole(roleName);

  if (!(await admin.databaseExists(dbName))) {
    const formatted = await admin.query<{ stmt: string }>(
      `SELECT format('CREATE DATABASE %I', $1::text) AS stmt`,
      [dbName],
    );
    await admin.query(formatted.rows[0].stmt);
  }

  // Só o role do tenant (e o admin) conecta no banco do tenant.
  const fmtRevoke = await admin.query<{ stmt: string }>(
    `SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', $1::text) AS stmt`,
    [dbName],
  );
  await admin.query(fmtRevoke.rows[0].stmt);
  const fmtGrant = await admin.query<{ stmt: string }>(
    `SELECT format('GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text) AS stmt`,
    [dbName, roleName],
  );
  await admin.query(fmtGrant.rows[0].stmt);

  // Privilégios dentro do banco do tenant (exigem conexão nesse banco).
  const tenantDb = admin.forDatabase(dbName);
  await tenantDb.query(`GRANT ALL ON SCHEMA "public" TO ${safeRole}`);
  await tenantDb.query(`GRANT ALL ON ALL TABLES IN SCHEMA "public" TO ${safeRole}`);
  await tenantDb.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA "public" TO ${safeRole}`);
  await tenantDb.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT ALL ON TABLES TO ${safeRole}`);
  await tenantDb.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT USAGE ON SEQUENCES TO ${safeRole}`);

  const connection = await storeConnection({
    tenantId,
    mode: 'DATABASE',
    url: admin.tenantUrl(roleName, password, { database: dbName }),
  });

  return {
    resources: {
      mode: 'DATABASE',
      database: dbName,
      schema: 'public',
      role: roleName,
      resourceIds: { database: dbName, role: roleName },
    },
    connection,
  };
}

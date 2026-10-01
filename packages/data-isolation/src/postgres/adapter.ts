import { createHash } from 'node:crypto';
import { PostgresAdmin, quoteIdentifier, quoteName } from './admin.js';
import { provisionSharedIsolation } from './shared.js';
import { provisionSchemaIsolation, provisionDatabaseIsolation } from './dedicated.js';
import { makeTenantIdentifier, tenantRoleName, IsolationError } from '../identifiers.js';
import type {
  IsolationAdapter,
  IsolationContext,
  TargetResources,
  CopyEvidence,
  ValidationEvidence,
  ActivationResult,
  ConnectionReference,
  StoredConnection,
  DataIsolationMode,
  TenantScopedTable,
} from '../types.js';

const COPY_BATCH_SIZE = 500;
const DEFAULT_ROLLBACK_HOURS = 24;

export interface PostgresAdapterOptions {
  adminUrl: string;
  storeConnection: (input: { tenantId: string; mode: DataIsolationMode; url: string }) => Promise<StoredConnection>;
  resolveConnection?: (reference: ConnectionReference) => Promise<string>;
  rollbackHours?: number;
}

/** Onde uma tabela do manifesto vive para um conjunto de recursos de isolamento. */
interface TableLocation {
  db: PostgresAdmin;
  qualifiedTable: string;
  /** SHARED: a tabela é compartilhada e precisa ser filtrada pelo tenant. */
  shared: boolean;
}

export class PostgresIsolationAdapter implements IsolationAdapter {
  private admin: PostgresAdmin;
  private options: PostgresAdapterOptions;
  private validationEvidence: ValidationEvidence | null = null;
  /** Conexões do tenant geradas em prepareTarget, entregues em activate. */
  private preparedConnections = new Map<string, StoredConnection>();

  constructor(options: PostgresAdapterOptions) {
    this.options = options;
    this.admin = new PostgresAdmin(options.adminUrl);
  }

  async prepareTarget(context: IsolationContext): Promise<TargetResources> {
    const { tenantId, targetMode } = context;

    let resources: TargetResources;
    let connection: StoredConnection;
    switch (targetMode) {
      case 'SHARED': {
        ({ resources, connection } = await provisionSharedIsolation(
          this.admin,
          tenantId,
          tenantRoleName(tenantId, 'SHARED'),
          context.manifest.tenantScopedTables,
          this.options.storeConnection,
        ));
        break;
      }
      case 'SCHEMA': {
        ({ resources, connection } = await provisionSchemaIsolation(
          this.admin,
          tenantId,
          makeTenantIdentifier('schema', tenantId),
          tenantRoleName(tenantId, 'SCHEMA'),
          this.options.storeConnection,
        ));
        break;
      }
      case 'DATABASE': {
        ({ resources, connection } = await provisionDatabaseIsolation(
          this.admin,
          tenantId,
          makeTenantIdentifier('db', tenantId),
          tenantRoleName(tenantId, 'DATABASE'),
          this.options.storeConnection,
        ));
        break;
      }
      default:
        throw new IsolationError('ISOLATION_MODE_INVALID', `Unknown isolation mode: ${targetMode}`);
    }
    this.preparedConnections.set(this.connectionKey(tenantId, resources.mode), connection);
    return resources;
  }

  async applyMigrations(context: IsolationContext, target: TargetResources): Promise<void> {
    if (target.mode === 'SHARED') {
      return;
    }
    const ref: ConnectionReference = { id: `${target.mode}:${context.tenantId}`, mode: target.mode };
    await context.manifest.applyMigrations(ref);
  }

  async copyData(context: IsolationContext, target: TargetResources): Promise<CopyEvidence> {
    const rowCounts: Record<string, number> = {};
    const tables = context.manifest.tenantScopedTables;

    if (!tables.length || !context.source) {
      return { rowCounts, copiedAt: new Date().toISOString() };
    }

    for (const table of tables) {
      const source = this.locate(context.source, table);
      const destination = this.locate(target, table);
      let totalCopied = 0;
      let offset = 0;

      for (;;) {
        const rows = await this.readBatch(source, table, context.tenantId, offset);
        if (rows.length === 0) break;

        await this.writeBatch(destination, table, rows);
        totalCopied += rows.length;
        offset += rows.length;

        if (rows.length < COPY_BATCH_SIZE) break;
      }

      rowCounts[table.table] = totalCopied;
    }

    return { rowCounts, copiedAt: new Date().toISOString() };
  }

  async validate(context: IsolationContext, target: TargetResources): Promise<ValidationEvidence> {
    const rowCounts: Record<string, number> = {};
    const checksums: Record<string, string> = {};

    for (const table of context.manifest.tenantScopedTables) {
      const destination = this.locate(target, table);
      const targetCount = await this.countRows(destination, table, context.tenantId);

      if (context.source) {
        const sourceCount = await this.countRows(this.locate(context.source, table), table, context.tenantId);
        if (sourceCount !== targetCount) {
          throw new IsolationError(
            'ISOLATION_VALIDATION_FAILED',
            `Row count mismatch for ${table.table}: source=${sourceCount}, target=${targetCount}`,
          );
        }
      }
      rowCounts[table.table] = targetCount;

      // SHA-256 sobre as linhas do tenant no destino, ordenadas pela PK.
      const hash = createHash('sha256');
      let offset = 0;
      for (;;) {
        const rows = await this.readBatch(destination, table, context.tenantId, offset);
        for (const row of rows) hash.update(JSON.stringify(row));
        offset += rows.length;
        if (rows.length < COPY_BATCH_SIZE) break;
      }
      checksums[table.table] = hash.digest('hex');
    }

    const ref: ConnectionReference = { id: `${target.mode}:${context.tenantId}`, mode: target.mode };
    await context.manifest.validate(ref, context.tenantId);

    const evidence: ValidationEvidence = { rowCounts, checksums, validatedAt: new Date().toISOString() };
    this.validationEvidence = evidence;
    return evidence;
  }

  async activate(context: IsolationContext, target: TargetResources): Promise<ActivationResult> {
    if (!this.validationEvidence) {
      throw new IsolationError('ISOLATION_VALIDATION_REQUIRED', 'Cannot activate without prior validation');
    }

    // A conexão ativada é a do tenant (gerada em prepareTarget), nunca a de admin.
    const storedConnection = this.preparedConnections.get(this.connectionKey(context.tenantId, target.mode));
    if (!storedConnection) {
      throw new IsolationError(
        'ISOLATION_CONNECTION_MISSING',
        'prepareTarget must run before activate to issue tenant credentials',
      );
    }

    const rollbackHours = this.options.rollbackHours ?? DEFAULT_ROLLBACK_HOURS;
    const cleanupAfter = new Date(Date.now() + rollbackHours * 60 * 60 * 1000).toISOString();

    return { storedConnection, cleanupAfter };
  }

  async rollback(context: IsolationContext, target: TargetResources): Promise<ConnectionReference> {
    if (!context.sourceConnection) {
      throw new IsolationError('ISOLATION_ROLLBACK_FAILED', 'Cannot rollback without a source connection reference');
    }

    if (this.options.resolveConnection) {
      try {
        await this.options.resolveConnection(context.sourceConnection);
      } catch {
        throw new IsolationError('ISOLATION_ROLLBACK_FAILED', 'Source connection is no longer valid for rollback');
      }
    }

    await this.compensate(context, target);
    return context.sourceConnection;
  }

  async compensate(context: IsolationContext, target: TargetResources): Promise<void> {
    switch (target.mode) {
      case 'SHARED': {
        for (const table of context.manifest.tenantScopedTables) {
          const qualifiedTable = `${quoteName(table.schema)}.${quoteName(table.table)}`;
          const policyName = quoteName(`org_tenant_isolation_${table.table}`);
          await this.admin.query(`DROP POLICY IF EXISTS ${policyName} ON ${qualifiedTable}`);
        }
        if (target.resourceIds.role) {
          const safeRole = quoteIdentifier(target.resourceIds.role);
          await this.admin.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM ${safeRole}`);
          await this.admin.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public" FROM ${safeRole}`);
          await this.admin.query(`REVOKE USAGE ON SCHEMA "public" FROM ${safeRole}`);
        }
        break;
      }
      case 'SCHEMA':
        await this.dropSchemaResources(target);
        break;
      case 'DATABASE':
        await this.dropDatabaseResources(target);
        break;
    }
  }

  async cleanupSource(context: IsolationContext, source: TargetResources): Promise<void> {
    switch (source.mode) {
      case 'SHARED': {
        // Remove apenas as linhas do tenant, sob o contexto RLS do tenant.
        for (const table of context.manifest.tenantScopedTables) {
          const qualifiedTable = `${quoteName(table.schema)}.${quoteName(table.table)}`;
          await this.admin.withTenantTransaction(context.tenantId, (client) =>
            client.query(`DELETE FROM ${qualifiedTable} WHERE ${quoteName(table.tenantColumn)} = $1`, [
              context.tenantId,
            ]),
          );
        }
        break;
      }
      case 'SCHEMA':
        await this.dropSchemaResources(source);
        break;
      case 'DATABASE':
        await this.dropDatabaseResources(source);
        break;
    }
  }

  async close(): Promise<void> {
    await this.admin.close();
  }

  private connectionKey(tenantId: string, mode: DataIsolationMode): string {
    return `${tenantId}:${mode}`;
  }

  private locate(resources: TargetResources, table: TenantScopedTable): TableLocation {
    const tableName = quoteName(table.table);
    switch (resources.mode) {
      case 'SCHEMA':
        return { db: this.admin, qualifiedTable: `${quoteIdentifier(resources.schema)}.${tableName}`, shared: false };
      case 'DATABASE':
        return {
          db: this.admin.forDatabase(resources.database),
          qualifiedTable: `${quoteName(table.schema)}.${tableName}`,
          shared: false,
        };
      default:
        return { db: this.admin, qualifiedTable: `${quoteName(table.schema)}.${tableName}`, shared: true };
    }
  }

  private async readBatch(
    location: TableLocation,
    table: TenantScopedTable,
    tenantId: string,
    offset: number,
  ): Promise<Record<string, unknown>[]> {
    const orderBy = quoteName(table.primaryKey);
    if (location.shared) {
      return location.db.withTenantTransaction(tenantId, async (client) => {
        const result = await client.query(
          `SELECT * FROM ${location.qualifiedTable} WHERE ${quoteName(table.tenantColumn)} = $1 ORDER BY ${orderBy} LIMIT $2 OFFSET $3`,
          [tenantId, COPY_BATCH_SIZE, offset],
        );
        return result.rows;
      });
    }
    const result = await location.db.query(
      `SELECT * FROM ${location.qualifiedTable} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
      [COPY_BATCH_SIZE, offset],
    );
    return result.rows;
  }

  private async writeBatch(
    location: TableLocation,
    table: TenantScopedTable,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const columns = Object.keys(rows[0]);
    const colNames = columns.map(quoteName).join(', ');
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${location.qualifiedTable} (${colNames}) VALUES (${placeholders}) ON CONFLICT (${quoteName(table.primaryKey)}) DO NOTHING`;

    await location.db.withTransaction(async (client) => {
      for (const row of rows) {
        await client.query(sql, columns.map((col) => row[col]));
      }
    });
  }

  private async countRows(location: TableLocation, table: TenantScopedTable, tenantId: string): Promise<number> {
    if (location.shared) {
      return location.db.withTenantTransaction(tenantId, async (client) => {
        const r = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ${location.qualifiedTable} WHERE ${quoteName(table.tenantColumn)} = $1`,
          [tenantId],
        );
        return parseInt(r.rows[0].count, 10);
      });
    }
    const r = await location.db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${location.qualifiedTable}`);
    return parseInt(r.rows[0].count, 10);
  }

  private async dropRole(roleName: string): Promise<void> {
    const formatted = await this.admin.query<{ stmt: string }>(
      `SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS stmt`,
      [roleName],
    );
    await this.admin.query(formatted.rows[0].stmt);
  }

  private async dropSchemaResources(resources: TargetResources): Promise<void> {
    const { schema, role } = resources.resourceIds;
    if (!schema || !role) return;
    await this.admin.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    // Privilégios default concedidos ao role impedem o DROP ROLE.
    await this.admin.query(`DROP OWNED BY ${quoteIdentifier(role)}`);
    await this.dropRole(role);
  }

  private async dropDatabaseResources(resources: TargetResources): Promise<void> {
    const { database, role } = resources.resourceIds;
    if (!database || !role) return;
    await this.admin.closeDatabase(database);
    await this.admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [database],
    );
    const fmtDrop = await this.admin.query<{ stmt: string }>(
      `SELECT format('DROP DATABASE IF EXISTS %I', $1::text) AS stmt`,
      [database],
    );
    await this.admin.query(fmtDrop.rows[0].stmt);
    await this.admin.query(`DROP OWNED BY ${quoteIdentifier(role)}`);
    await this.dropRole(role);
  }
}

import { createHash } from 'node:crypto';
import { PostgresAdmin, quoteIdentifier } from './admin.js';
import { provisionSharedIsolation } from './shared.js';
import { provisionSchemaIsolation, provisionDatabaseIsolation } from './dedicated.js';
import { makeTenantIdentifier, IsolationError } from '../identifiers.js';
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

export class PostgresIsolationAdapter implements IsolationAdapter {
  private admin: PostgresAdmin;
  private options: PostgresAdapterOptions;
  private validationEvidence: ValidationEvidence | null = null;

  constructor(options: PostgresAdapterOptions) {
    this.options = options;
    this.admin = new PostgresAdmin(options.adminUrl);
  }

  async prepareTarget(context: IsolationContext): Promise<TargetResources> {
    const { tenantId, targetMode } = context;

    switch (targetMode) {
      case 'SHARED': {
        const role = makeTenantIdentifier('role', tenantId);
        const result = await provisionSharedIsolation(
          this.admin,
          tenantId,
          role,
          context.manifest.tenantScopedTables,
          this.options.storeConnection,
          this.options.adminUrl,
        );
        return result.resources;
      }
      case 'SCHEMA': {
        const schema = makeTenantIdentifier('schema', tenantId);
        const role = makeTenantIdentifier('role', tenantId);
        return provisionSchemaIsolation(
          this.admin,
          tenantId,
          schema,
          role,
          this.options.storeConnection,
          this.options.adminUrl,
        );
      }
      case 'DATABASE': {
        const db = makeTenantIdentifier('db', tenantId);
        const role = makeTenantIdentifier('role', tenantId);
        return provisionDatabaseIsolation(
          this.admin,
          tenantId,
          db,
          role,
          this.options.storeConnection,
          this.options.adminUrl,
        );
      }
      default:
        throw new IsolationError('ISOLATION_MODE_INVALID', `Unknown isolation mode: ${targetMode}`);
    }
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
      let totalCopied = 0;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        // Read batch from source
        const rows = await this.readSourceBatch(context, table, offset);
        if (rows.length === 0) {
          hasMore = false;
          break;
        }

        // Write batch to target
        await this.writeTargetBatch(target, table, rows);
        totalCopied += rows.length;
        offset += rows.length;

        if (rows.length < COPY_BATCH_SIZE) {
          hasMore = false;
        }
      }

      rowCounts[table.table] = totalCopied;
    }

    return { rowCounts, copiedAt: new Date().toISOString() };
  }

  private async readSourceBatch(
    context: IsolationContext,
    table: TenantScopedTable,
    offset: number,
  ): Promise<Record<string, unknown>[]> {
    const qualifiedTable = `"${table.schema}"."${table.table}"`;
    const sourceMode = context.sourceMode;

    if (sourceMode === 'SHARED') {
      // SHARED reads always use transaction with tenant context
      return this.admin.withClient(async (client) => {
        await client.query('BEGIN');
        await client.query('SET LOCAL app.tenant_id = $1', [context.tenantId]);
        const result = await client.query(
          `SELECT * FROM ${qualifiedTable} WHERE "${table.tenantColumn}" = $1 ORDER BY "${table.primaryKey}" LIMIT $2 OFFSET $3`,
          [context.tenantId, COPY_BATCH_SIZE, offset],
        );
        await client.query('COMMIT');
        return result.rows;
      });
    }

    // For SCHEMA/DATABASE, the source connection has its own isolation
    const result = await this.admin.query(
      `SELECT * FROM ${qualifiedTable} ORDER BY "${table.primaryKey}" LIMIT $1 OFFSET $2`,
      [COPY_BATCH_SIZE, offset],
    );
    return result.rows;
  }

  private async writeTargetBatch(
    target: TargetResources,
    table: TenantScopedTable,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    if (rows.length === 0) return;

    const columns = Object.keys(rows[0]);
    const targetSchema = target.mode === 'SCHEMA' ? target.schema : table.schema;
    const qualifiedTable = `"${targetSchema}"."${table.table}"`;

    for (const row of rows) {
      const values = columns.map((col) => row[col]);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const colNames = columns.map((c) => `"${c}"`).join(', ');
      await this.admin.query(
        `INSERT INTO ${qualifiedTable} (${colNames}) VALUES (${placeholders}) ON CONFLICT ("${table.primaryKey}") DO NOTHING`,
        values,
      );
    }
  }

  async validate(context: IsolationContext, target: TargetResources): Promise<ValidationEvidence> {
    const rowCounts: Record<string, number> = {};
    const checksums: Record<string, string> = {};
    const tables = context.manifest.tenantScopedTables;

    for (const table of tables) {
      // Count target rows
      const targetSchema = target.mode === 'SCHEMA' ? target.schema : table.schema;
      const targetTable = `"${targetSchema}"."${table.table}"`;
      const countResult = await this.admin.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM ${targetTable}`,
      );
      const targetCount = parseInt(countResult.rows[0].count, 10);

      // Count source rows
      let sourceCount = 0;
      if (context.source) {
        const sourceSchema = context.source.mode === 'SCHEMA' ? context.source.schema : table.schema;
        const sourceTable = `"${sourceSchema}"."${table.table}"`;

        if (context.sourceMode === 'SHARED') {
          const srcResult = await this.admin.withClient(async (client) => {
            await client.query('BEGIN');
            await client.query('SET LOCAL app.tenant_id = $1', [context.tenantId]);
            const r = await client.query<{ count: string }>(
              `SELECT COUNT(*) as count FROM ${sourceTable} WHERE "${table.tenantColumn}" = $1`,
              [context.tenantId],
            );
            await client.query('COMMIT');
            return r;
          });
          sourceCount = parseInt(srcResult.rows[0].count, 10);
        } else {
          const srcResult = await this.admin.query<{ count: string }>(
            `SELECT COUNT(*) as count FROM ${sourceTable}`,
          );
          sourceCount = parseInt(srcResult.rows[0].count, 10);
        }

        if (sourceCount !== targetCount) {
          throw new IsolationError(
            'ISOLATION_VALIDATION_FAILED',
            `Row count mismatch for ${table.table}: source=${sourceCount}, target=${targetCount}`,
          );
        }
      }

      rowCounts[table.table] = targetCount;

      // Compute SHA-256 checksum over stable JSON rows ordered by primary key
      const allRows = await this.admin.query(
        `SELECT * FROM ${targetTable} ORDER BY "${table.primaryKey}"`,
      );
      const hash = createHash('sha256');
      for (const row of allRows.rows) {
        hash.update(JSON.stringify(row));
      }
      checksums[table.table] = hash.digest('hex');
    }

    // Call manifest validation
    const ref: ConnectionReference = { id: `${target.mode}:${context.tenantId}`, mode: target.mode };
    await context.manifest.validate(ref, context.tenantId);

    const evidence: ValidationEvidence = {
      rowCounts,
      checksums,
      validatedAt: new Date().toISOString(),
    };
    this.validationEvidence = evidence;
    return evidence;
  }

  async activate(context: IsolationContext, target: TargetResources): Promise<ActivationResult> {
    if (!this.validationEvidence) {
      throw new IsolationError(
        'ISOLATION_VALIDATION_REQUIRED',
        'Cannot activate without prior validation',
      );
    }

    // Store the target connection
    const storedConnection = await this.options.storeConnection({
      tenantId: context.tenantId,
      mode: target.mode,
      url: this.options.adminUrl, // The actual connection URL is managed by storeConnection callback
    });

    const rollbackHours = this.options.rollbackHours ?? DEFAULT_ROLLBACK_HOURS;
    const cleanupAfter = new Date(Date.now() + rollbackHours * 60 * 60 * 1000).toISOString();

    return { storedConnection, cleanupAfter };
  }

  async rollback(context: IsolationContext, target: TargetResources): Promise<ConnectionReference> {
    if (!context.sourceConnection) {
      throw new IsolationError(
        'ISOLATION_ROLLBACK_FAILED',
        'Cannot rollback without a source connection reference',
      );
    }

    // Validate source is still usable
    if (this.options.resolveConnection) {
      try {
        await this.options.resolveConnection(context.sourceConnection);
      } catch {
        throw new IsolationError(
          'ISOLATION_ROLLBACK_FAILED',
          'Source connection is no longer valid for rollback',
        );
      }
    }

    // Compensate the target
    await this.compensate(context, target);

    return context.sourceConnection;
  }

  async compensate(context: IsolationContext, target: TargetResources): Promise<void> {
    const { mode } = target;

    switch (mode) {
      case 'SHARED': {
        // Revoke RLS policies and role privileges
        for (const table of context.manifest.tenantScopedTables) {
          const qualifiedTable = `"${table.schema}"."${table.table}"`;
          const policyName = `org_tenant_isolation_${table.table}`;
          await this.admin.query(`DROP POLICY IF EXISTS "${policyName}" ON ${qualifiedTable}`);
        }
        if (target.resourceIds.role) {
          const safeRole = quoteIdentifier(target.resourceIds.role);
          await this.admin.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM ${safeRole}`);
          await this.admin.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public" FROM ${safeRole}`);
          await this.admin.query(`REVOKE USAGE ON SCHEMA "public" FROM ${safeRole}`);
        }
        break;
      }
      case 'SCHEMA': {
        if (target.resourceIds.schema && target.resourceIds.role) {
          const safeSchema = quoteIdentifier(target.resourceIds.schema);
          const safeRole = quoteIdentifier(target.resourceIds.role);
          await this.admin.query(`DROP SCHEMA IF EXISTS ${safeSchema} CASCADE`);
          const formatted = await this.admin.query<{ stmt: string }>(
            `SELECT format('DROP ROLE IF EXISTS %I', $1) AS stmt`,
            [target.resourceIds.role],
          );
          await this.admin.query(formatted.rows[0].stmt);
        }
        break;
      }
      case 'DATABASE': {
        if (target.resourceIds.database && target.resourceIds.role) {
          // Terminate connections
          await this.admin.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [target.resourceIds.database],
          );
          const fmtDrop = await this.admin.query<{ stmt: string }>(
            `SELECT format('DROP DATABASE IF EXISTS %I', $1) AS stmt`,
            [target.resourceIds.database],
          );
          await this.admin.query(fmtDrop.rows[0].stmt);
          const fmtRole = await this.admin.query<{ stmt: string }>(
            `SELECT format('DROP ROLE IF EXISTS %I', $1) AS stmt`,
            [target.resourceIds.role],
          );
          await this.admin.query(fmtRole.rows[0].stmt);
        }
        break;
      }
    }
  }

  async cleanupSource(context: IsolationContext, source: TargetResources): Promise<void> {
    switch (source.mode) {
      case 'SHARED': {
        // Delete only tenant's rows under protected context
        for (const table of context.manifest.tenantScopedTables) {
          const qualifiedTable = `"${table.schema}"."${table.table}"`;
          await this.admin.withClient(async (client) => {
            await client.query('BEGIN');
            await client.query('SET LOCAL app.tenant_id = $1', [context.tenantId]);
            await client.query(
              `DELETE FROM ${qualifiedTable} WHERE "${table.tenantColumn}" = $1`,
              [context.tenantId],
            );
            await client.query('COMMIT');
          });
        }
        break;
      }
      case 'SCHEMA': {
        if (source.resourceIds.schema && source.resourceIds.role) {
          const safeSchema = quoteIdentifier(source.resourceIds.schema);
          await this.admin.query(`DROP SCHEMA IF EXISTS ${safeSchema} CASCADE`);
          const formatted = await this.admin.query<{ stmt: string }>(
            `SELECT format('DROP ROLE IF EXISTS %I', $1) AS stmt`,
            [source.resourceIds.role],
          );
          await this.admin.query(formatted.rows[0].stmt);
        }
        break;
      }
      case 'DATABASE': {
        if (source.resourceIds.database && source.resourceIds.role) {
          await this.admin.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [source.resourceIds.database],
          );
          const fmtDrop = await this.admin.query<{ stmt: string }>(
            `SELECT format('DROP DATABASE IF EXISTS %I', $1) AS stmt`,
            [source.resourceIds.database],
          );
          await this.admin.query(fmtDrop.rows[0].stmt);
          const fmtRole = await this.admin.query<{ stmt: string }>(
            `SELECT format('DROP ROLE IF EXISTS %I', $1) AS stmt`,
            [source.resourceIds.role],
          );
          await this.admin.query(fmtRole.rows[0].stmt);
        }
        break;
      }
    }
  }

  async close(): Promise<void> {
    await this.admin.close();
  }
}

import { PostgresAdmin } from './admin.js';
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
} from '../types.js';

export interface PostgresAdapterOptions {
  adminUrl: string;
  storeConnection: (input: { tenantId: string; mode: string; url: string }) => Promise<StoredConnection>;
  resolveConnection?: (reference: ConnectionReference) => Promise<string>;
  rollbackHours?: number;
}

export class PostgresIsolationAdapter implements IsolationAdapter {
  private admin: PostgresAdmin;
  private options: PostgresAdapterOptions;

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
      // Shared mode uses the existing schema
      return;
    }
    const ref: ConnectionReference = { id: `${target.mode}:${context.tenantId}`, mode: target.mode };
    await context.manifest.applyMigrations(ref);
  }

  async copyData(_context: IsolationContext, _target: TargetResources): Promise<CopyEvidence> {
    // Implemented in Task 4
    return { rowCounts: {}, copiedAt: new Date().toISOString() };
  }

  async validate(_context: IsolationContext, _target: TargetResources): Promise<ValidationEvidence> {
    // Implemented in Task 4
    return { rowCounts: {}, checksums: {}, validatedAt: new Date().toISOString() };
  }

  async activate(_context: IsolationContext, _target: TargetResources): Promise<ActivationResult> {
    // Implemented in Task 4
    throw new IsolationError('ISOLATION_NOT_IMPLEMENTED', 'activate() will be implemented in Task 4');
  }

  async rollback(_context: IsolationContext, _target: TargetResources): Promise<ConnectionReference> {
    // Implemented in Task 4
    throw new IsolationError('ISOLATION_NOT_IMPLEMENTED', 'rollback() will be implemented in Task 4');
  }

  async compensate(_context: IsolationContext, _target: TargetResources): Promise<void> {
    // Implemented in Task 4
  }

  async cleanupSource(_context: IsolationContext, _source: TargetResources): Promise<void> {
    // Implemented in Task 4
  }

  async close(): Promise<void> {
    await this.admin.close();
  }
}

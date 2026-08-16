export type DataIsolationMode = 'SHARED' | 'SCHEMA' | 'DATABASE';

export type IsolationPhase =
  | 'PREPARE'
  | 'PROVISION_TARGET'
  | 'APPLY_MIGRATIONS'
  | 'COPY'
  | 'VALIDATE'
  | 'CUTOVER'
  | 'READY'
  | 'ROLLBACK'
  | 'FAILED';

export interface TenantScopedTable {
  schema: string;
  table: string;
  tenantColumn: 'tenant_id';
  primaryKey: string;
}

export interface ValidationEvidence {
  rowCounts: Record<string, number>;
  checksums: Record<string, string>;
  validatedAt: string;
}

export interface CopyEvidence {
  rowCounts: Record<string, number>;
  copiedAt: string;
}

export interface ConnectionReference {
  id: string;
  mode: DataIsolationMode;
}

export interface StoredConnection {
  reference: ConnectionReference;
  encryptedPayload: Record<string, string>;
}

export interface ActivationResult {
  storedConnection: StoredConnection;
  cleanupAfter: string;
}

export interface TargetResources {
  mode: DataIsolationMode;
  database: string;
  schema: string;
  role: string;
  resourceIds: Record<string, string>;
}

export interface IsolationManifest {
  apiVersion: 'organator.io/v1alpha1';
  product: string;
  tenantScopedTables: TenantScopedTable[];
  applyMigrations(connection: ConnectionReference): Promise<void>;
  validate(connection: ConnectionReference, tenantId: string): Promise<ValidationEvidence>;
}

export interface IsolationContext {
  tenantId: string;
  generation: number;
  sourceMode: DataIsolationMode | null;
  targetMode: DataIsolationMode;
  source: TargetResources | null;
  sourceConnection: ConnectionReference | null;
  manifest: IsolationManifest;
}

export interface IsolationAdapter {
  prepareTarget(context: IsolationContext): Promise<TargetResources>;
  applyMigrations(context: IsolationContext, target: TargetResources): Promise<void>;
  copyData(context: IsolationContext, target: TargetResources): Promise<CopyEvidence>;
  validate(context: IsolationContext, target: TargetResources): Promise<ValidationEvidence>;
  activate(context: IsolationContext, target: TargetResources): Promise<ActivationResult>;
  rollback(context: IsolationContext, target: TargetResources): Promise<ConnectionReference>;
  compensate(context: IsolationContext, target: TargetResources): Promise<void>;
  cleanupSource(context: IsolationContext, source: TargetResources): Promise<void>;
}

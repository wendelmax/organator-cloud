import type { IsolationManifest, TenantScopedTable } from '@organator/data-isolation';

/**
 * Configuração do isolamento de dados (data plane), lida do ambiente:
 *
 * - DATA_ISOLATION_ENABLED=true    liga a reconciliação (padrão: desligada)
 * - DATA_ISOLATION_ADMIN_URL       Postgres do DATA PLANE com privilégios de DDL
 *                                  (CREATE ROLE/DATABASE). Não é o banco do control plane.
 * - DATA_ISOLATION_TABLES          JSON com as tabelas do produto que têm escopo de tenant:
 *                                  [{"table":"orders","tenantColumn":"tenant_id","primaryKey":"id","schema":"public"}]
 *                                  (schema, tenantColumn e primaryKey são opcionais)
 * - DATA_ISOLATION_ROLLBACK_HOURS  janela antes da limpeza da origem (padrão 24)
 */
export type DataIsolationConfig =
  | { enabled: false }
  | {
      enabled: true;
      adminUrl: string;
      rollbackHours: number;
      tables: TenantScopedTable[];
    };

const SQL_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export class DataIsolationConfigError extends Error {}

export function loadDataIsolationConfig(env: NodeJS.ProcessEnv = process.env): DataIsolationConfig {
  if (env.DATA_ISOLATION_ENABLED !== 'true') {
    return { enabled: false };
  }

  const adminUrl = env.DATA_ISOLATION_ADMIN_URL?.trim();
  if (!adminUrl) {
    throw new DataIsolationConfigError('DATA_ISOLATION_ADMIN_URL is required when DATA_ISOLATION_ENABLED=true');
  }
  try {
    const parsed = new URL(adminUrl);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new DataIsolationConfigError('DATA_ISOLATION_ADMIN_URL must be a postgresql:// connection string');
  }

  const rollbackHours = env.DATA_ISOLATION_ROLLBACK_HOURS ? Number(env.DATA_ISOLATION_ROLLBACK_HOURS) : 24;
  if (!Number.isInteger(rollbackHours) || rollbackHours < 1) {
    throw new DataIsolationConfigError('DATA_ISOLATION_ROLLBACK_HOURS must be a positive integer');
  }

  return { enabled: true, adminUrl, rollbackHours, tables: parseTables(env.DATA_ISOLATION_TABLES) };
}

function parseTables(raw: string | undefined): TenantScopedTable[] {
  if (!raw?.trim()) {
    throw new DataIsolationConfigError('DATA_ISOLATION_TABLES is required when DATA_ISOLATION_ENABLED=true');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DataIsolationConfigError('DATA_ISOLATION_TABLES must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new DataIsolationConfigError('DATA_ISOLATION_TABLES must be a non-empty JSON array');
  }

  const seen = new Set<string>();
  return parsed.map((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const table: TenantScopedTable = {
      schema: (item.schema as string) ?? 'public',
      table: item.table as string,
      tenantColumn: (item.tenantColumn as string) ?? 'tenant_id',
      primaryKey: (item.primaryKey as string) ?? 'id',
    };
    for (const [field, value] of Object.entries(table)) {
      if (typeof value !== 'string' || !SQL_NAME.test(value)) {
        throw new DataIsolationConfigError(`DATA_ISOLATION_TABLES[${index}].${field} must be a valid SQL identifier`);
      }
    }
    const key = `${table.schema}.${table.table}`;
    if (seen.has(key)) {
      throw new DataIsolationConfigError(`DATA_ISOLATION_TABLES lists ${key} more than once`);
    }
    seen.add(key);
    return table;
  });
}

/**
 * Manifesto usado pelo reconciler: as tabelas configuradas, com a estrutura
 * criada automaticamente nos destinos SCHEMA/DATABASE a partir das tabelas
 * compartilhadas (o produto não precisa fornecer migrações por tenant).
 */
export function buildManifest(tables: TenantScopedTable[]): IsolationManifest {
  return {
    apiVersion: 'organator.io/v1alpha1',
    product: 'organator-cloud',
    structure: 'clone-shared',
    tenantScopedTables: tables,
    async applyMigrations() {},
    async validate() {
      return { rowCounts: {}, checksums: {}, validatedAt: new Date().toISOString() };
    },
  };
}

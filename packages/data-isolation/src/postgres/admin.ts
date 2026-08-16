import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { IsolationError } from '../identifiers.js';

const SAFE_IDENTIFIER_RE = /^org_(role|schema|db)_[a-f0-9]{12}$/;

export function quoteIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER_RE.test(value)) {
    throw new IsolationError('ISOLATION_IDENTIFIER_INVALID', 'Generated PostgreSQL identifier is invalid');
  }
  return `"${value}"`;
}

export class PostgresAdmin {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async databaseExists(name: string): Promise<boolean> {
    const result = await this.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [name],
    );
    return result.rows[0].exists;
  }

  async roleExists(name: string): Promise<boolean> {
    const result = await this.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
      [name],
    );
    return result.rows[0].exists;
  }

  async schemaExists(name: string): Promise<boolean> {
    const result = await this.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists',
      [name],
    );
    return result.rows[0].exists;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

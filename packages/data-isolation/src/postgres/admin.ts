import { randomBytes } from 'node:crypto';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { IsolationError } from '../identifiers.js';

const SAFE_IDENTIFIER_RE = /^org_(role|schema|db)_[a-f0-9]{12}$/;

export function quoteIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER_RE.test(value)) {
    throw new IsolationError('ISOLATION_IDENTIFIER_INVALID', 'Generated PostgreSQL identifier is invalid');
  }
  return `"${value}"`;
}

/** Quoting para nomes vindos do manifesto do produto (schema/tabela/coluna). */
export function quoteName(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export class PostgresAdmin {
  private pool: Pool;
  private readonly databases = new Map<string, PostgresAdmin>();

  constructor(private readonly connectionString: string) {
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

  /**
   * Executa fn numa transação. Em erro faz ROLLBACK antes de devolver a
   * conexão ao pool — sem isso a conexão volta com a transação abortada e
   * envenena as próximas consultas ("current transaction is aborted").
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      client.release();
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
        client.release();
      } catch {
        client.release(true);
      }
      throw err;
    }
  }

  /** Transação com app.tenant_id definido (usado pelas políticas RLS do modo SHARED). */
  async withTenantTransaction<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withTransaction(async (client) => {
      // SET não aceita parâmetros; set_config(..., true) equivale a SET LOCAL.
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return fn(client);
    });
  }

  /** Conexão administrativa para outro banco do mesmo servidor (cacheada). */
  forDatabase(name: string): PostgresAdmin {
    quoteIdentifier(name);
    let admin = this.databases.get(name);
    if (!admin) {
      const url = new URL(this.connectionString);
      url.pathname = `/${name}`;
      admin = new PostgresAdmin(url.toString());
      this.databases.set(name, admin);
    }
    return admin;
  }

  /** Fecha o pool de um banco (necessário antes de DROP DATABASE). */
  async closeDatabase(name: string): Promise<void> {
    const admin = this.databases.get(name);
    if (admin) {
      this.databases.delete(name);
      await admin.close();
    }
  }

  /**
   * Garante um role de login para o tenant e devolve uma senha válida. Se o
   * role já existe a senha é rotacionada — é a única forma de obter
   * credenciais utilizáveis ao reexecutar um provisionamento.
   */
  async ensureLoginRole(roleName: string): Promise<string> {
    const password = randomBytes(32).toString('base64url');
    const statement = (await this.roleExists(roleName))
      ? `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS stmt`
      : `SELECT format('CREATE ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text, $2::text) AS stmt`;
    const formatted = await this.query<{ stmt: string }>(statement, [roleName, password]);
    await this.query(formatted.rows[0].stmt);
    return password;
  }

  /** URL de conexão do tenant: mesmo servidor, credenciais do role do tenant. */
  tenantUrl(roleName: string, password: string, options: { database?: string; searchPath?: string } = {}): string {
    const url = new URL(this.connectionString);
    url.username = roleName;
    url.password = password;
    if (options.database) url.pathname = `/${options.database}`;
    if (options.searchPath) url.searchParams.set('options', `-c search_path=${options.searchPath}`);
    return url.toString();
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
    await Promise.all([...this.databases.values()].map((db) => db.close()));
    this.databases.clear();
    await this.pool.end();
  }
}

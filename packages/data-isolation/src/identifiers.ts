import { createHash } from 'node:crypto';

const VALID_PREFIXES = ['role', 'schema', 'db'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class IsolationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IsolationError';
  }
}

export function makeTenantIdentifier(prefix: string, tenantId: string): string {
  const lower = prefix.toLowerCase();
  if (!(VALID_PREFIXES as readonly string[]).includes(lower)) {
    throw new IsolationError(
      'ISOLATION_IDENTIFIER_INVALID',
      `Invalid prefix: must be one of ${VALID_PREFIXES.join(', ')}`,
    );
  }

  let hex: string;
  if (UUID_RE.test(tenantId)) {
    hex = tenantId.replace(/-/g, '').toLowerCase().slice(0, 12);
  } else {
    hex = createHash('sha256').update(tenantId).digest('hex').slice(0, 12);
  }

  const identifier = `org_${lower}_${hex}`;

  // PostgreSQL identifier limit is 63 bytes
  if (Buffer.byteLength(identifier) > 63) {
    throw new IsolationError(
      'ISOLATION_IDENTIFIER_INVALID',
      'Generated PostgreSQL identifier exceeds 63-byte limit',
    );
  }

  return identifier;
}

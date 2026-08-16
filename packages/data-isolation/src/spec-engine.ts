import { createHash } from 'node:crypto';

export function validateTenantSpec(spec: Record<string, any>): boolean {
  if (!spec || typeof spec !== 'object') return false;
  if (!spec.databaseConfig || !spec.networkConfig) return false;
  return true;
}

export function calculateBackupChecksum(payload: string | Buffer): string {
  return createHash('sha256').update(payload).digest('hex');
}

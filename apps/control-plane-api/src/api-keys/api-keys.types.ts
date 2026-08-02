/**
 * Escopos de API keys (#33). Cada escopo limita o acesso a rotas específicas.
 */
export const API_KEY_SCOPES = {
  SERVICES_READ: 'services:read',
  SERVICES_WRITE: 'services:write',
  SERVICES_DEPLOY: 'services:deploy',
  DOCS_READ: 'docs:read',
  DOCS_WRITE: 'docs:write',
  TENANTS_READ: 'tenants:read',
} as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[keyof typeof API_KEY_SCOPES];

export const ALL_SCOPES: ApiKeyScope[] = Object.values(API_KEY_SCOPES);

export const API_KEY_PREFIX = 'sk_';

/** Resultado da validação de token, sem hash (nunca exposto). */
export interface ValidatedApiKey {
  id: string;
  name: string;
  scopes: string[];
  tenantId: string | null;
  expiresAt: Date | null;
  tenant?: { state: string } | null;
}

/** Valida e normaliza a lista de escopos, ignorando desconhecidos. */
export function normalizeScopes(scopes?: string[]): ApiKeyScope[] {
  if (!Array.isArray(scopes)) return [];
  return scopes
    .filter((s): s is ApiKeyScope => (ALL_SCOPES as string[]).includes(s))
    .filter((s, i, arr) => arr.indexOf(s) === i);
}

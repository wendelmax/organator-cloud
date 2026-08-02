export type QuotaResourceType =
  | 'MICROSERVICE'
  | 'DEPLOYMENT'
  | 'SEATS'
  | 'APIS'
  | 'DOMAINS'
  | 'GB_STORAGE';

export type LimitType = 'soft' | 'hard';

export const QUOTA_RESOURCES: QuotaResourceType[] = [
  'MICROSERVICE',
  'DEPLOYMENT',
  'SEATS',
  'APIS',
  'DOMAINS',
  'GB_STORAGE',
];

// Feature flags canônicas resolvidas pelo engine (o engine também aceita chaves custom).
export const KNOWN_FEATURES = [
  'whitelabel',
  'api_keys',
  'sso_saml',
  'audit_logs',
  'domains_custom',
  'strategies',
];

export interface TenantEntitlements {
  tenantId: string;
  plan: string;
  quotas: Record<string, number>;
  features: Record<string, boolean>;
  limits: Record<string, LimitType>;
  computedAt: Date;
}

export interface QuotaExceededErrorBody {
  statusCode: number;
  code: 'QUOTA_EXCEEDED';
  message: string;
  plan: string;
  resource: QuotaResourceType;
  limit: number;
  usage: number;
  limitType: LimitType;
}

export interface FeatureNotEnabledErrorBody {
  statusCode: number;
  code: 'FEATURE_NOT_ENABLED';
  message: string;
  plan: string;
  feature: string;
}

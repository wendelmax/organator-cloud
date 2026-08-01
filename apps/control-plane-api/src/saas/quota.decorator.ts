import { SetMetadata } from '@nestjs/common';

export type QuotaResourceType =
  | 'MICROSERVICE'
  | 'DEPLOYMENT'
  | 'SEATS'
  | 'APIS'
  | 'DOMAINS'
  | 'GB_STORAGE';

export const QUOTA_RESOURCES: QuotaResourceType[] = [
  'MICROSERVICE',
  'DEPLOYMENT',
  'SEATS',
  'APIS',
  'DOMAINS',
  'GB_STORAGE',
];

export const QUOTA_KEY = 'quota_resource_type';

export const CheckQuota = (resourceType: QuotaResourceType) =>
  SetMetadata(QUOTA_KEY, resourceType);

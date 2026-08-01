import { SetMetadata } from '@nestjs/common';

export type QuotaResourceType = 'MICROSERVICE' | 'DEPLOYMENT';

export const QUOTA_KEY = 'quota_resource_type';

export const CheckQuota = (resourceType: QuotaResourceType) =>
  SetMetadata(QUOTA_KEY, resourceType);

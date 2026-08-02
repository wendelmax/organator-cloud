import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'require_feature';

/**
 * Exige que a feature esteja habilitada no plano efetivo do tenant.
 * Ex.: @RequireFeature('api_keys')
 */
export const RequireFeature = (feature: string) =>
  SetMetadata(FEATURE_KEY, feature);

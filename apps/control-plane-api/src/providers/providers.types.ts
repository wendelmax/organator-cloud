import { SECRET_FIELDS } from '@organator/cloud-providers';
import type { ProviderType } from '@organator/cloud-providers';

export { SECRET_FIELDS };
export type { ProviderType };

export interface CreateProviderCredentialInput {
  type: ProviderType;
  name: string;
  secrets: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface UpdateProviderCredentialInput {
  name?: string;
  secrets?: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface ResolvedProviderCredential {
  type: ProviderType;
  name: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

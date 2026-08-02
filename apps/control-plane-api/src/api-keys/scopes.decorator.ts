import { SetMetadata } from '@nestjs/common';
import { ApiKeyScope } from './api-keys.types';

export const SCOPES_KEY = 'apiKeyScopes';

/**
 * Declara os escopos necessários para a rota quando autenticada via API key.
 * Usuários humanos continuam autorizados pelo RolesGuard (papel).
 */
export const Scopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(SCOPES_KEY, scopes);

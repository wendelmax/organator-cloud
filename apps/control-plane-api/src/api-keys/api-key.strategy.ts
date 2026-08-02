import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-strategy';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyScope, API_KEY_PREFIX } from './api-keys.types';

/**
 * Estratégia 'api-key': resolve `Authorization: Bearer sk_...` para um
 * contexto de automação (user sintético + keyScopes). Tokens que não são
 * API key falham silenciosamente para a estratégia JWT/OIDC assumir.
 */
@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor(private readonly apiKeysService: ApiKeysService) {
    super();
  }

  /**
   * Stub para satisfazer o tipo do mixin PassportStrategy — a extração do
   * Bearer acontece em authenticate() (fluxo custom sem passport-http-bearer).
   */
  validate(): void {
    return;
  }

  authenticate(req: any): void {
    const header = req?.headers?.['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7)
        : null;

    if (!token || !token.startsWith(API_KEY_PREFIX)) {
      return this.fail(401);
    }

    this.apiKeysService
      .validate(token)
      .then((key) => {
        if (!key) {
          return this.fail(401);
        }
        this.success({
          userId: key.id,
          apiKeyId: key.id,
          apiKeyAuth: true,
          name: key.name,
          role: 'API_KEY',
          tenantId: key.tenantId ?? undefined,
          keyScopes: (key.scopes ?? []) as ApiKeyScope[],
        });
      })
      .catch((err) => this.error(err));
  }
}

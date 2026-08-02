import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { API_KEY_PREFIX } from '../api-keys/api-keys.types';

/** Rotas que não dependem do tenant logado (webhook, auth, docs públicos). */
const PUBLIC_PATHS = [
  '/v1/onboarding/webhook',
  '/v1/onboarding/checkout',
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/callback',
  '/v1/docs/public',
  '/health',
];

/**
 * Guard global de estado do tenant (#46):
 * - past_due        => leitura OK, escrita bloqueada (403 TENANT_PAST_DUE)
 * - suspended       => acesso totalmente bloqueado (403 TENANT_SUSPENDED)
 * - offboarding/deleted => acesso bloqueado (403)
 * - active/onboarding   => liberado
 *
 * Funciona tanto para tokens JWT quanto para API keys (sk_...). Requisições
 * sem token, token inválido ou sem tenant passam para os guards de
 * autenticação/autorização decidirem.
 */
@Injectable()
export class TenantStateGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly lifecycle: TenantLifecycleService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const path = req.url?.split('?')[0] || '';
    if (PUBLIC_PATHS.some((p) => path.startsWith(p))) {
      return true;
    }

    const token = this.extractBearer(req);
    if (!token) {
      return true; // sem token: guard de auth cuida do 401
    }

    // API key: resolve o tenantId da chave (sem efeitos colaterais).
    if (token.startsWith(API_KEY_PREFIX)) {
      const tenantId = await this.apiKeysService.resolveTenantId(token);
      if (!tenantId) {
        return true; // chave inválida/expirada: guard de auth rejeita
      }
      await this.lifecycle.assertAccess(tenantId, req.method);
      return true;
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      return true; // token inválido: guard de auth rejeita
    }

    const tenantId = payload?.tenantId;
    if (!tenantId) {
      return true; // usuário sem tenant (platform) não é regido pelo estado
    }

    await this.lifecycle.assertAccess(tenantId, req.method);
    return true;
  }

  private extractBearer(req: any): string | null {
    const header = req.headers?.['authorization'];
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }
    return null;
  }
}

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenantLifecycleService } from './tenant-lifecycle.service';

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
 * Requisições sem JWT ou sem tenant (ex.: PLATFORM_ADMIN) passam para os
 * guards de autenticação/autorização decidirem.
 */
@Injectable()
export class TenantStateGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly lifecycle: TenantLifecycleService,
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

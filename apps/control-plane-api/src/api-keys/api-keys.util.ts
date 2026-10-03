import { ForbiddenException } from '@nestjs/common';

/**
 * Quem pode operar em qualquer tenant: admin da plataforma ou API key de
 * plataforma (sem tenantId). Os demais ficam presos ao próprio tenant.
 */
export function canActOnAnyTenant(req: any): boolean {
  const user = req?.user;
  if (!user) return false;
  if (user.apiKeyAuth) return !user.tenantId;
  if (user.role === 'SUPPORT') {
    // Suporte lê qualquer tenant, mas nunca escreve.
    return ['GET', 'HEAD', 'OPTIONS'].includes(
      String(req.method || 'GET').toUpperCase(),
    );
  }
  return user.role === 'PLATFORM_ADMIN';
}

/**
 * Resolve o tenant efetivo da requisição:
 * - admin da plataforma / API key de plataforma => o tenant pedido (ou o próprio)
 * - API key vinculada a um tenant => sempre o tenant da chave (ignora o pedido)
 * - usuário comum => o tenant ativo da sessão; pedir outro é 403
 */
export function effectiveTenantFor(
  req: any,
  requestedTenantId?: string,
): string {
  const user = req?.user;
  if (canActOnAnyTenant(req)) {
    const tenantId = requestedTenantId || user?.tenantId;
    if (!tenantId) throw new ForbiddenException('A tenant must be specified');
    return tenantId;
  }
  if (user?.apiKeyAuth) return user.tenantId;
  const own = user?.tenantId;
  if (!own || (requestedTenantId && requestedTenantId !== own)) {
    throw new ForbiddenException('Access to this tenant is not allowed');
  }
  return own;
}

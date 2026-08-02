/**
 * Resolve o tenant efetivo de uma requisição de API key:
 * - chave vinculada a um tenant (key.tenantId) => sempre usa o tenant da chave
 *   (ignora tenantId de path/body para evitar escalação de acesso)
 * - chave de plataforma (sem tenantId) => usa o tenantId requisitado
 * - usuário humano => usa o tenantId requisitado
 */
export function effectiveTenantFor(
  req: any,
  requestedTenantId?: string,
): string | undefined {
  if (req?.user?.apiKeyAuth) {
    return req.user.tenantId ?? requestedTenantId;
  }
  return requestedTenantId;
}

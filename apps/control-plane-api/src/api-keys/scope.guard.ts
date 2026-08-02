import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCOPES_KEY } from './scopes.decorator';
import { ApiKeyScope } from './api-keys.types';

/**
 * Aplica escopos de API key (#33):
 * - Rota sem @Scopes => passa
 * - Usuário humano (sem keyScopes) => passa (papéis governam via RolesGuard)
 * - API key => TODOS os escopos declarados devem estar em keyScopes
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !Array.isArray(user.keyScopes)) {
      return true; // humano autenticado: autorização via RolesGuard
    }

    const granted = user.keyScopes as string[];
    return requiredScopes.every((scope) => granted.includes(scope));
  }
}

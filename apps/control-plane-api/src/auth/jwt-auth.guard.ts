import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { resolveAuthMode } from './oidc.strategy';
import { AUTH_MODES } from './oidc.strategy';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Guard de autenticação híbrido:
 * - AUTH_MODE=legacy -> apenas JWT próprio (JwtStrategy)
 * - AUTH_MODE=oidc   -> apenas tokens OIDC (OidcStrategy, via JWKS)
 * - AUTH_MODE=both   -> tenta ambos (default durante migração)
 *
 * Também bloqueia acesso pleno quando o usuário tem mustChangePassword
 * ativo, exceto em rotas marcadas com @AllowPasswordChange().
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(
  resolveAuthMode() === 'legacy'
    ? 'jwt'
    : resolveAuthMode() === 'oidc'
      ? 'oidc'
      : ['jwt', 'oidc'],
) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const authenticated = await super.canActivate(context);
    if (!authenticated) return false;

    const allowPasswordChange = this.reflector.getAllAndOverride<boolean>(
      'allowPasswordChange',
      [context.getHandler(), context.getClass()],
    );
    const { user } = context.switchToHttp().getRequest();
    if (user?.mustChangePassword && !allowPasswordChange) {
      throw new ForbiddenException({
        code: 'MUST_CHANGE_PASSWORD',
        message:
          'Você precisa definir uma nova senha antes de acessar o painel.',
      });
    }
    return true;
  }
}

export { AUTH_MODES };

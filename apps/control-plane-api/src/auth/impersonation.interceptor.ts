import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { AuditService } from '../audit/audit.service';

/**
 * Ações que o suporte nunca faz em nome do usuário: credenciais, MFA, sessões,
 * troca de tenant, chaves de API (acesso que sobreviveria à sessão) e direitos
 * do titular (consentimento, exportação, exclusão).
 */
const BLOCKED_WHILE_IMPERSONATING: RegExp[] = [
  /^\/v1\/auth\/(change-password|mfa|sessions|switch-tenant|password)/,
  /^\/v1\/auth\/impersonate\/?$/,
  /^\/v1\/api-keys/,
  /^\/v1\/compliance\/(erasure|consents|export-request|exports|users|tenants)/,
  /^\/v1\/tenants\/current\/password-policy/,
];

export function isBlockedForImpersonation(
  method: string,
  path: string,
): boolean {
  // Leituras de exportações/sessões também ficam de fora (dados pessoais do titular).
  return (
    BLOCKED_WHILE_IMPERSONATING.some((pattern) => pattern.test(path)) &&
    !(method === 'POST' && path === '/v1/auth/impersonate/stop')
  );
}

/**
 * Em sessão de suporte (claim impersonator): bloqueia ações sensíveis e grava
 * cada requisição no audit log (quem assumiu, método, caminho e status).
 */
@Injectable()
export class ImpersonationInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const impersonatorId: string | undefined = req.user?.impersonatorId;
    if (!impersonatorId) return next.handle();

    const method = String(req.method || 'GET').toUpperCase();
    const path = String(req.url || '').split('?')[0];
    const record = (status: number) =>
      this.audit
        .record({
          actorId: impersonatorId,
          ip: req.ip ?? null,
          action: 'auth.impersonated_request',
          resourceType: 'User',
          resourceId: req.user.userId,
          changes: { method, path, status, sessionId: req.user.sessionId },
        })
        .catch(() => undefined);

    if (isBlockedForImpersonation(method, path)) {
      void record(403);
      throw new ForbiddenException(
        'This action is not available in a support session',
      );
    }
    return next.handle().pipe(
      tap(
        () =>
          void record(context.switchToHttp().getResponse()?.statusCode ?? 200),
      ),
      catchError((err) => {
        void record(err?.status ?? 500);
        return throwError(() => err);
      }),
    );
  }
}

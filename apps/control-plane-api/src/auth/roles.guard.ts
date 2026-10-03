import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/** Métodos de leitura: os únicos liberados ao papel SUPPORT. */
export const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * SUPPORT (#103): leitura ampla na plataforma (qualquer rota protegida por
 * papel, inclusive as de PLATFORM_ADMIN), mas nenhuma escrita.
 */
export function supportCanRead(
  role: string | undefined,
  method: string | undefined,
) {
  return (
    String(role || '').toUpperCase() === 'SUPPORT' &&
    READ_METHODS.includes(String(method || 'GET').toUpperCase())
  );
}

const ROLE_PERMISSIONS: Record<string, string[]> = {
  PLATFORM_ADMIN: [
    'PLATFORM_ADMIN',
    'SUPPORT',
    'OWNER',
    'ADMIN',
    'BILLING',
    'MEMBER',
    'DEVELOPER',
    'VIEWER',
  ],
  OWNER: ['OWNER', 'ADMIN', 'BILLING', 'MEMBER', 'DEVELOPER', 'VIEWER'],
  ADMIN: ['ADMIN', 'MEMBER', 'DEVELOPER', 'VIEWER'],
  BILLING: ['BILLING', 'VIEWER'],
  MEMBER: ['MEMBER', 'VIEWER'],
  DEVELOPER: ['DEVELOPER', 'VIEWER'],
  VIEWER: ['VIEWER'],
};

/** Papéis que existem dentro de um tenant (PLATFORM_ADMIN é só da plataforma). */
export const TENANT_ROLES = [
  'OWNER',
  'ADMIN',
  'BILLING',
  'MEMBER',
  'DEVELOPER',
  'VIEWER',
];

/**
 * Pode `actorRole` atribuir `role` a alguém do tenant? Só papéis de tenant e
 * dentro do próprio alcance: um ADMIN não cria OWNER e ninguém cria
 * PLATFORM_ADMIN pela gestão de membros/convites.
 */
export function canAssignRole(
  actorRole: string | undefined,
  role: string,
): boolean {
  const target = String(role || '').toUpperCase();
  // SUPPORT é papel da plataforma: só o admin da plataforma concede.
  if (target === 'SUPPORT') {
    return String(actorRole || '').toUpperCase() === 'PLATFORM_ADMIN';
  }
  if (!TENANT_ROLES.includes(target)) return false;
  const granted = ROLE_PERMISSIONS[String(actorRole || '').toUpperCase()] || [];
  return granted.includes(target);
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const { user } = req;
    if (!user || !user.role) {
      return false;
    }
    if (String(user.role).toUpperCase() === 'SUPPORT') {
      return supportCanRead(user.role, req.method);
    }

    const userRole = String(user.role).toUpperCase();
    const grantedRoles = ROLE_PERMISSIONS[userRole] || [];

    return requiredRoles.some((role) =>
      grantedRoles.includes(role.toUpperCase()),
    );
  }
}

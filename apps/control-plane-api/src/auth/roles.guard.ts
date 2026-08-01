import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

const ROLE_PERMISSIONS: Record<string, string[]> = {
  PLATFORM_ADMIN: ['PLATFORM_ADMIN', 'OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER'],
  OWNER: ['OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER'],
  ADMIN: ['ADMIN', 'DEVELOPER', 'VIEWER'],
  DEVELOPER: ['DEVELOPER', 'VIEWER'],
  VIEWER: ['VIEWER'],
};

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

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role) {
      return false;
    }

    const userRole = String(user.role).toUpperCase();
    const grantedRoles = ROLE_PERMISSIONS[userRole] || [];

    return requiredRoles.some((role) =>
      grantedRoles.includes(role.toUpperCase()),
    );
  }
}

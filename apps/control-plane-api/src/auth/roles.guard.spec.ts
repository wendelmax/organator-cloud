import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(userRole?: string): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: userRole ? { role: userRole } : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should allow access if no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext('VIEWER');
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access if user is missing or role is missing', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const contextNoUser = createMockContext();
    expect(guard.canActivate(contextNoUser)).toBe(false);
  });

  it('should allow OWNER access to OWNER, ADMIN, DEVELOPER, VIEWER endpoints', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const contextOwner = createMockContext('OWNER');
    expect(guard.canActivate(contextOwner)).toBe(true);
  });

  it('should allow ADMIN access to ADMIN, DEVELOPER, VIEWER endpoints but deny OWNER', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['OWNER']);
    const contextAdmin = createMockContext('ADMIN');
    expect(guard.canActivate(contextAdmin)).toBe(false);

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(guard.canActivate(contextAdmin)).toBe(true);

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DEVELOPER']);
    expect(guard.canActivate(contextAdmin)).toBe(true);
  });

  it('should allow DEVELOPER access to DEVELOPER, VIEWER endpoints but deny ADMIN/OWNER', () => {
    const contextDev = createMockContext('DEVELOPER');

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(guard.canActivate(contextDev)).toBe(false);

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DEVELOPER']);
    expect(guard.canActivate(contextDev)).toBe(true);

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['VIEWER']);
    expect(guard.canActivate(contextDev)).toBe(true);
  });

  it('should allow VIEWER access only to VIEWER endpoints', () => {
    const contextViewer = createMockContext('VIEWER');

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DEVELOPER']);
    expect(guard.canActivate(contextViewer)).toBe(false);

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['VIEWER']);
    expect(guard.canActivate(contextViewer)).toBe(true);
  });

  it('should allow access if user has one of multiple required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['OWNER', 'ADMIN']);
    const contextAdmin = createMockContext('ADMIN');
    expect(guard.canActivate(contextAdmin)).toBe(true);
  });
});

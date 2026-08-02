import { ExecutionContext } from '@nestjs/common';
import { ScopeGuard } from './scope.guard';

describe('ScopeGuard', () => {
  let guard: ScopeGuard;
  let reflector: any;

  const makeCtx = (user: any): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new ScopeGuard(reflector);
  });

  it('passes when route declares no scopes', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(makeCtx({ keyScopes: [] }))).toBe(true);
  });

  it('passes for human users (no keyScopes) regardless of required scopes', () => {
    reflector.getAllAndOverride.mockReturnValue(['services:write']);
    expect(guard.canActivate(makeCtx({ role: 'OWNER' }))).toBe(true);
  });

  it('passes when API key grants all required scopes', () => {
    reflector.getAllAndOverride.mockReturnValue(['services:read', 'docs:read']);
    expect(
      guard.canActivate(
        makeCtx({
          apiKeyAuth: true,
          keyScopes: ['services:read', 'docs:read'],
        }),
      ),
    ).toBe(true);
  });

  it('blocks API key missing a required scope', () => {
    reflector.getAllAndOverride.mockReturnValue(['services:write']);
    expect(
      guard.canActivate(
        makeCtx({ apiKeyAuth: true, keyScopes: ['services:read'] }),
      ),
    ).toBe(false);
  });

  it('blocks API key with no scopes on a scoped route', () => {
    reflector.getAllAndOverride.mockReturnValue(['services:read']);
    expect(
      guard.canActivate(makeCtx({ apiKeyAuth: true, keyScopes: [] })),
    ).toBe(false);
  });
});

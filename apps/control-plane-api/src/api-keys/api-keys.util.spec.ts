import { ForbiddenException } from '@nestjs/common';
import { canActOnAnyTenant, effectiveTenantFor } from './api-keys.util';

describe('effectiveTenantFor', () => {
  const owner = { user: { tenantId: 't-1', role: 'OWNER' } };
  const admin = { user: { tenantId: 't-platform', role: 'PLATFORM_ADMIN' } };
  const tenantKey = { user: { apiKeyAuth: true, tenantId: 't-key' } };
  const platformKey = { user: { apiKeyAuth: true, tenantId: null } };

  it('keeps regular users inside their active tenant', () => {
    expect(effectiveTenantFor(owner)).toBe('t-1');
    expect(effectiveTenantFor(owner, 't-1')).toBe('t-1');
    expect(() => effectiveTenantFor(owner, 't-2')).toThrow(ForbiddenException);
  });

  it('rejects a user without an active tenant', () => {
    expect(() =>
      effectiveTenantFor({ user: { role: 'OWNER' } }, 't-1'),
    ).toThrow(ForbiddenException);
    expect(() => effectiveTenantFor({}, 't-1')).toThrow(ForbiddenException);
  });

  it('lets platform admins and platform keys choose the tenant', () => {
    expect(effectiveTenantFor(admin, 't-9')).toBe('t-9');
    expect(effectiveTenantFor(admin)).toBe('t-platform');
    expect(effectiveTenantFor(platformKey, 't-9')).toBe('t-9');
    expect(() => effectiveTenantFor(platformKey)).toThrow(ForbiddenException);
  });

  it('pins tenant-bound API keys to their own tenant', () => {
    expect(effectiveTenantFor(tenantKey, 't-other')).toBe('t-key');
  });

  it('only platform admins and platform keys act on any tenant', () => {
    expect(canActOnAnyTenant(admin)).toBe(true);
    expect(canActOnAnyTenant(platformKey)).toBe(true);
    expect(canActOnAnyTenant(owner)).toBe(false);
    expect(canActOnAnyTenant(tenantKey)).toBe(false);
    expect(canActOnAnyTenant({})).toBe(false);
  });
});

describe('canActOnAnyTenant — SUPPORT', () => {
  it('reads any tenant but cannot write to one', () => {
    const support = (method: string) => ({
      method,
      user: { role: 'SUPPORT', tenantId: 't-platform' },
    });
    expect(canActOnAnyTenant(support('GET'))).toBe(true);
    expect(canActOnAnyTenant(support('POST'))).toBe(false);
    expect(effectiveTenantFor(support('GET'), 't-9')).toBe('t-9');
    expect(() => effectiveTenantFor(support('POST'), 't-9')).toThrow(
      ForbiddenException,
    );
  });
});

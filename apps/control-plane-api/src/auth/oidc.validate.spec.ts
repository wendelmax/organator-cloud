import { UnauthorizedException } from '@nestjs/common';
import { OidcStrategy, resolveAuthMode } from './oidc.strategy';

describe('OidcStrategy — claims validation and discovery', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let prisma: any;
  let mfaPolicy: any;
  let strategy: OidcStrategy;
  const dbUser = {
    id: 'u1',
    email: 'o@acme.com',
    role: 'OWNER',
    tenantId: 't1',
    mustChangePassword: false,
    authProvider: 'oidc',
  };

  beforeEach(() => {
    prisma = { user: { findFirst: jest.fn().mockResolvedValue(dbUser) } };
    mfaPolicy = { requiresMfa: jest.fn().mockResolvedValue(false) };
    strategy = new OidcStrategy(prisma, mfaPolicy);
    delete process.env.VOIDAUTH_ISSUER;
    delete process.env.VOIDAUTH_CLIENT_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('resolveAuthMode defaults to both and ignores invalid values', () => {
    delete process.env.AUTH_MODE;
    expect(resolveAuthMode()).toBe('both');
    process.env.AUTH_MODE = 'OIDC';
    expect(resolveAuthMode()).toBe('oidc');
    process.env.AUTH_MODE = 'magic';
    expect(resolveAuthMode()).toBe('both');
  });

  it('maps the token to the local user — role and tenant always come from the database', async () => {
    const user = await strategy.validate({
      sub: 'ext-1',
      email: 'o@acme.com',
      role: 'PLATFORM_ADMIN',
      tenantId: 'evil',
    });
    expect(user).toEqual({
      userId: 'u1',
      email: 'o@acme.com',
      role: 'OWNER',
      tenantId: 't1',
      mustChangePassword: false,
      authProvider: 'oidc',
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ email: 'o@acme.com' }, { externalId: 'ext-1' }] },
    });
  });

  it('returns null for unknown users', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'x' })).resolves.toBeNull();
  });

  it('requires email or sub', async () => {
    await expect(strategy.validate({})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('enforces issuer and audience when configured', async () => {
    process.env.VOIDAUTH_ISSUER = 'https://auth.acme.com';
    await expect(
      strategy.validate({ sub: 's', iss: 'https://evil.com' }),
    ).rejects.toThrow('unknown issuer');

    process.env.VOIDAUTH_CLIENT_ID = 'organator';
    await expect(
      strategy.validate({
        sub: 's',
        iss: 'https://auth.acme.com',
        aud: 'other',
      }),
    ).rejects.toThrow('audience mismatch');
    await expect(
      strategy.validate({
        sub: 's',
        iss: 'https://auth.acme.com',
        aud: 'organator',
      }),
    ).resolves.toMatchObject({ userId: 'u1' });
  });

  it('blocks tokens without MFA when the tenant requires it', async () => {
    mfaPolicy.requiresMfa.mockResolvedValue(true);
    await expect(strategy.validate({ sub: 's' })).rejects.toThrow(
      'MFA_REQUIRED_FOR_TENANT',
    );
    expect(mfaPolicy.requiresMfa).toHaveBeenCalledWith('t1', 'OWNER', false);
  });

  it.each([[{ amr: ['pwd', 'mfa'] }], [{ acr: 'mfa' }]])(
    'signals IdP MFA to the policy (%j)',
    async (claims) => {
      await strategy.validate({ sub: 's', ...claims });
      expect(mfaPolicy.requiresMfa).toHaveBeenCalledWith('t1', 'OWNER', true);
    },
  );

  describe('discovery errors', () => {
    const resolve = (s: any) =>
      s.resolveSigningKey('eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.e30.sig');

    it('fails without VOIDAUTH_URL', async () => {
      delete process.env.VOIDAUTH_URL;
      await expect(resolve(strategy)).rejects.toThrow(
        'VOIDAUTH_URL not configured',
      );
    });

    it('fails when discovery returns an error', async () => {
      process.env.VOIDAUTH_URL = 'https://auth.acme.com/';
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 503 }) as any;
      await expect(resolve(strategy)).rejects.toThrow('HTTP 503');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://auth.acme.com/oidc/.well-known/openid-configuration',
      );
    });

    it('fails when discovery has no jwks_uri', async () => {
      process.env.VOIDAUTH_URL = 'https://auth.acme.com';
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
      await expect(resolve(strategy)).rejects.toThrow('jwks_uri');
    });
  });
});

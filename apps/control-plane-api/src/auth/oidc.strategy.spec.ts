import { OidcStrategy } from './oidc.strategy';

describe('OidcStrategy', () => {
  const originalFetch = global.fetch;
  const originalVoidAuthUrl = process.env.VOIDAUTH_URL;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalVoidAuthUrl === undefined) delete process.env.VOIDAUTH_URL;
    else process.env.VOIDAUTH_URL = originalVoidAuthUrl;
  });

  it('resolves an asymmetric signing key through OIDC discovery and JWKS', async () => {
    const jose = await import('jose');
    const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
    const publicJwk = await jose.exportJWK(publicKey);
    publicJwk.kid = 'key-1';
    publicJwk.alg = 'RS256';
    const token = await new jose.SignJWT({ sub: 'external-user' })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .sign(privateKey);

    process.env.VOIDAUTH_URL = 'https://id.organator.example';
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.endsWith('/oidc/.well-known/openid-configuration')) {
        return Response.json({ jwks_uri: 'https://id.organator.example/jwks' });
      }
      if (url === 'https://id.organator.example/jwks') {
        return Response.json({ keys: [publicJwk] });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const strategy = new OidcStrategy({} as never);
    const pem = await (
      strategy as unknown as {
        resolveSigningKey(rawJwtToken: string): Promise<string>;
      }
    ).resolveSigningKey(token);

    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

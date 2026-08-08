import { readSecurityConfig } from './security.config';

describe('readSecurityConfig', () => {
  const production = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(32),
    ENCRYPTION_KEY: 'b'.repeat(64),
    CORS_ORIGINS:
      'https://admin.organator.example,https://app.organator.example',
  } as NodeJS.ProcessEnv;

  it('rejects production without a JWT secret', () => {
    const env = { ...production };
    delete env.JWT_SECRET;
    expect(() => readSecurityConfig(env)).toThrow('JWT_SECRET');
  });

  it('rejects production without an encryption key', () => {
    const env = { ...production };
    delete env.ENCRYPTION_KEY;
    expect(() => readSecurityConfig(env)).toThrow('ENCRYPTION_KEY');
  });

  it('rejects the shipped development secrets in production', () => {
    expect(() =>
      readSecurityConfig({
        ...production,
        JWT_SECRET: 'super_secret_jwt_key_change_in_production',
      }),
    ).toThrow('JWT_SECRET');

    expect(() =>
      readSecurityConfig({
        ...production,
        ENCRYPTION_KEY:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      }),
    ).toThrow('ENCRYPTION_KEY');
  });

  it('rejects wildcard CORS origins in production', () => {
    expect(() =>
      readSecurityConfig({ ...production, CORS_ORIGINS: '*' }),
    ).toThrow('CORS_ORIGINS');
  });

  it('rejects an encryption key that is not 64 hexadecimal characters', () => {
    expect(() =>
      readSecurityConfig({ ...production, ENCRYPTION_KEY: 'not-a-key' }),
    ).toThrow('ENCRYPTION_KEY');
  });

  it('parses production origins, proxy trust, and security limits', () => {
    expect(
      readSecurityConfig({
        ...production,
        RATE_LIMIT_WINDOW_MS: '30000',
        TRUST_PROXY_HOPS: '2',
      }),
    ).toMatchObject({
      isProduction: true,
      corsOrigins: [
        'https://admin.organator.example',
        'https://app.organator.example',
      ],
      bodyLimit: 1_048_576,
      trustProxy: 2,
      rateLimit: { max: 100, timeWindow: 30_000 },
      healthRateLimit: { max: 1_000, timeWindow: 30_000 },
    });
  });

  it('does not trust proxy headers unless proxy hops are explicitly enabled', () => {
    expect(readSecurityConfig(production).trustProxy).toBe(false);
    expect(
      readSecurityConfig({ ...production, TRUST_PROXY_HOPS: '0' }).trustProxy,
    ).toBe(false);
  });
});

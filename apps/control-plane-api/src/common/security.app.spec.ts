import {
  configureAppSecurity,
  createFastifyAdapter,
  readSecurityConfig,
} from './security.config';

describe('security config — parsing and app wiring', () => {
  const dev = {} as NodeJS.ProcessEnv;

  it('has safe development defaults', () => {
    expect(readSecurityConfig(dev)).toMatchObject({
      isProduction: false,
      corsOrigins: ['http://localhost:3001'],
      bodyLimit: 1_048_576,
      trustProxy: false,
      rateLimit: { max: 100, timeWindow: 60_000 },
      healthRateLimit: { max: 1000, timeWindow: 60_000 },
    });
  });

  it('parses rate limits and proxy hops', () => {
    const cfg = readSecurityConfig({
      RATE_LIMIT_MAX: '20',
      RATE_LIMIT_WINDOW_MS: '1000',
      HEALTH_RATE_LIMIT_MAX: '5',
      TRUST_PROXY_HOPS: '2',
    });
    expect(cfg.rateLimit).toEqual({ max: 20, timeWindow: 1000 });
    expect(cfg.healthRateLimit).toEqual({ max: 5, timeWindow: 1000 });
    // Legado: hops > 0 vira "confiar em proxies de rede privada" (fastify >= 5.12 ignora hops).
    expect(cfg.trustProxy).toEqual(['loopback', 'linklocal', 'uniquelocal']);
    expect(readSecurityConfig({ TRUST_PROXY_HOPS: '0' }).trustProxy).toBe(
      false,
    );
  });

  it('prefers explicit TRUST_PROXY addresses and CIDRs', () => {
    expect(
      readSecurityConfig({
        TRUST_PROXY: '10.0.0.0/8, 192.168.1.5,::1',
        TRUST_PROXY_HOPS: '3',
      }).trustProxy,
    ).toEqual(['10.0.0.0/8', '192.168.1.5', '::1']);
    expect(readSecurityConfig({ TRUST_PROXY: 'loopback' }).trustProxy).toEqual([
      'loopback',
    ]);
    expect(
      readSecurityConfig({ TRUST_PROXY: 'false', TRUST_PROXY_HOPS: '1' })
        .trustProxy,
    ).toBe(false);
  });

  it.each(['*', 'true', 'example.com', '10.0.0.0/abc', '999.1.1.1'])(
    'rejects invalid TRUST_PROXY %s',
    (value) => {
      expect(() => readSecurityConfig({ TRUST_PROXY: value })).toThrow(
        'TRUST_PROXY',
      );
    },
  );

  it.each(['0', '-1', '1.5', 'abc'])('rejects invalid rate limit %s', (v) => {
    expect(() => readSecurityConfig({ RATE_LIMIT_MAX: v })).toThrow(
      'positive integers',
    );
  });

  it.each([
    '*',
    'https://a.com,*',
    'ftp://files.acme.com',
    'https://app.acme.com/path',
    ' , ',
  ])('rejects unsafe CORS_ORIGINS %j', (origins) => {
    expect(() => readSecurityConfig({ CORS_ORIGINS: origins })).toThrow(
      'CORS_ORIGINS',
    );
  });

  it('requires CORS_ORIGINS in production', () => {
    expect(() =>
      readSecurityConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(32),
        ENCRYPTION_KEY: 'a'.repeat(64),
      }),
    ).toThrow('CORS_ORIGINS must be configured');
  });

  it('builds the Fastify adapter with body limit and trust proxy', () => {
    const adapter = createFastifyAdapter(
      readSecurityConfig({ TRUST_PROXY_HOPS: '1' }),
    );
    const fastify = adapter.getInstance();
    expect(fastify.initialConfig.bodyLimit).toBe(1_048_576);
  });

  describe('configureAppSecurity', () => {
    const registered: any[] = [];
    const app: any = {
      register: jest.fn(async (plugin: unknown, opts: unknown) =>
        registered.push([plugin, opts]),
      ),
      enableCors: jest.fn(),
      useGlobalPipes: jest.fn(),
    };

    beforeAll(async () => {
      await configureAppSecurity(app, {
        CORS_ORIGINS: 'https://app.acme.com',
        RATE_LIMIT_MAX: '50',
        HEALTH_RATE_LIMIT_MAX: '500',
      });
    });

    it('registers helmet with CSP disabled outside production', () => {
      expect(registered[0][1]).toEqual({ contentSecurityPolicy: false });
    });

    it('applies a looser rate limit only to /health', () => {
      const opts = registered[1][1];
      expect(opts.max({ url: '/health' })).toBe(500);
      expect(opts.max({ url: '/health?full=1' })).toBe(500);
      expect(opts.max({ url: '/healthz' })).toBe(50);
      expect(opts.max({ url: '/v1/auth/login' })).toBe(50);
      expect(opts.timeWindow({ url: '/health' })).toBe(60_000);
      expect(opts.keyGenerator({ ip: '1.2.3.4' })).toBe('1.2.3.4');
    });

    it('restricts CORS to the configured origins', () => {
      expect(app.enableCors).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: ['https://app.acme.com'],
          allowedHeaders: ['Authorization', 'Content-Type'],
        }),
      );
    });

    it('installs a whitelist validation pipe', () => {
      const pipe = app.useGlobalPipes.mock.calls[0][0];
      expect(pipe.validatorOptions).toMatchObject({
        whitelist: true,
        forbidNonWhitelisted: true,
      });
    });
  });
});

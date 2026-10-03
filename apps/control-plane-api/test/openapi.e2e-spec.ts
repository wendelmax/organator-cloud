import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthController } from './../src/auth/auth.controller';
import { AuthService } from './../src/auth/auth.service';
import { MfaService } from './../src/auth/mfa.service';
import { MfaPolicyService } from './../src/auth/mfa-policy.service';
import { PasswordResetService } from './../src/auth/password-reset.service';
import { ImpersonationService } from './../src/auth/impersonation.service';
import { AuditService } from './../src/audit/audit.service';
import { ApiKeysController } from './../src/api-keys/api-keys.controller';
import { ApiKeysService } from './../src/api-keys/api-keys.service';
import { AppController } from './../src/app.controller';
import { AppService } from './../src/app.service';
import { apiDocsEnabled, setupApiDocs } from './../src/common/openapi';

describe('OpenAPI documentation (e2e)', () => {
  let app: NestFastifyApplication;
  let spec: {
    openapi: string;
    info: { version: string };
    paths: Record<
      string,
      Record<string, { security?: unknown[]; tags?: string[] }>
    >;
    components: { securitySchemes: Record<string, unknown> };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController, AuthController, ApiKeysController],
      providers: [
        AppService,
        { provide: AuthService, useValue: {} },
        { provide: MfaService, useValue: {} },
        { provide: MfaPolicyService, useValue: {} },
        { provide: PasswordResetService, useValue: {} },
        { provide: ImpersonationService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: ApiKeysService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    setupApiDocs(app, '9.9.9');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({
      method: 'GET',
      url: '/docs/openapi.json',
    });
    expect(response.statusCode).toBe(200);
    spec = response.json();
  });

  afterAll(async () => {
    await app.close();
  });

  it('publishes an OpenAPI 3 document with the API version and bearer scheme', () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.version).toBe('9.9.9');
    expect(spec.components.securitySchemes.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('documents public routes without security', () => {
    expect(spec.paths['/v1/auth/login'].post.security).toBeUndefined();
    expect(spec.paths['/v1/auth/refresh'].post.security).toBeUndefined();
    expect(spec.paths['/health'].get.security).toBeUndefined();
  });

  it('marks routes guarded by JwtAuthGuard as bearer-protected (method and class level)', () => {
    expect(spec.paths['/v1/auth/me'].get.security).toEqual([{ bearer: [] }]);
    expect(spec.paths['/v1/api-keys'].post.security).toEqual([{ bearer: [] }]);
    expect(spec.paths['/v1/api-keys/{id}'].delete.security).toEqual([
      { bearer: [] },
    ]);
  });

  it('tags operations by controller', () => {
    expect(spec.paths['/v1/api-keys'].get.tags).toEqual(['ApiKeys']);
    expect(spec.paths['/v1/auth/login'].post.tags).toEqual(['Auth']);
  });

  it('serves the interactive UI', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('swagger-ui');
  });
});

describe('apiDocsEnabled', () => {
  it('is on outside production and opt-in in production', () => {
    expect(apiDocsEnabled({})).toBe(true);
    expect(apiDocsEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(
      apiDocsEnabled({ NODE_ENV: 'production', API_DOCS_ENABLED: 'true' }),
    ).toBe(true);
    expect(apiDocsEnabled({ API_DOCS_ENABLED: 'false' })).toBe(false);
  });
});

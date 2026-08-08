import { Body, Controller, Post } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { IsString } from 'class-validator';
import { AppController } from './../src/app.controller';
import { AppService } from './../src/app.service';
import {
  configureAppSecurity,
  createFastifyAdapter,
  readSecurityConfig,
} from './../src/common/security.config';

class ValidationProbeDto {
  @IsString()
  name!: string;
}

@Controller('validation-probe')
class ValidationProbeController {
  @Post()
  create(@Body() body: ValidationProbeDto) {
    return body;
  }
}

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController, ValidationProbeController],
      providers: [AppService],
    }).compile();

    const env = {
      NODE_ENV: 'test',
      CORS_ORIGINS: 'https://admin.organator.example',
      RATE_LIMIT_MAX: '2',
      HEALTH_RATE_LIMIT_MAX: '4',
      RATE_LIMIT_WINDOW_MS: '60000',
      TRUST_PROXY_HOPS: '1',
    } as NodeJS.ProcessEnv;
    const security = readSecurityConfig(env);

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(security),
    );
    await configureAppSecurity(app, env);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET)', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('does not allow an origin outside the configured CORS allowlist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { origin: 'https://evil.example' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows an origin in the configured CORS allowlist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { origin: 'https://admin.organator.example' },
    });

    expect(response.headers['access-control-allow-origin']).toBe(
      'https://admin.organator.example',
    );
  });

  it('adds HTTP security headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects requests that exceed the configured global rate limit', async () => {
    const first = await app.inject({ method: 'GET', url: '/' });
    const second = await app.inject({ method: 'GET', url: '/' });
    const third = await app.inject({ method: 'GET', url: '/' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
  });

  it('applies the higher, finite rate limit to health probes', async () => {
    const responses = [];
    for (let requestNumber = 0; requestNumber < 5; requestNumber += 1) {
      responses.push(await app.inject({ method: 'GET', url: '/health' }));
    }

    expect(responses.slice(0, 4).map(({ statusCode }) => statusCode)).toEqual([
      200, 200, 200, 200,
    ]);
    expect(responses[4].statusCode).toBe(429);
  });

  it('uses the forwarded client address behind one trusted proxy', async () => {
    const clientAHeaders = { 'x-forwarded-for': '203.0.113.10' };
    const clientBHeaders = { 'x-forwarded-for': '203.0.113.11' };

    await app.inject({ method: 'GET', url: '/', headers: clientAHeaders });
    await app.inject({ method: 'GET', url: '/', headers: clientAHeaders });
    const blockedA = await app.inject({
      method: 'GET',
      url: '/',
      headers: clientAHeaders,
    });
    const allowedB = await app.inject({
      method: 'GET',
      url: '/',
      headers: clientBHeaders,
    });

    expect(blockedA.statusCode).toBe(429);
    expect(allowedB.statusCode).toBe(200);
  });

  it('rejects unknown DTO fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/validation-probe',
      payload: { name: 'valid', elevated: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain(
      'property elevated should not exist',
    );
  });

  it('rejects payloads larger than one mebibyte', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/validation-probe',
      payload: { name: 'x'.repeat(1_048_576) },
    });

    expect(response.statusCode).toBe(413);
  });
});

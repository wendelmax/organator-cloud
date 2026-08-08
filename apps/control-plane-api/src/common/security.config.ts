import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

export interface SecurityConfig {
  isProduction: boolean;
  corsOrigins: string[];
  jwtSecret: string;
  encryptionKey: string;
  bodyLimit: number;
  trustProxy: number | false;
  rateLimit: { max: number; timeWindow: number };
  healthRateLimit: { max: number; timeWindow: number };
}

const DEFAULT_JWT_SECRET = 'super_secret_jwt_key_change_in_production';
const DEFAULT_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export function readSecurityConfig(
  env: NodeJS.ProcessEnv = process.env,
): SecurityConfig {
  const isProduction = env.NODE_ENV === 'production';
  const jwtSecret = env.JWT_SECRET || DEFAULT_JWT_SECRET;
  const encryptionKey = env.ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY;
  const corsOrigins = parseOrigins(env.CORS_ORIGINS, isProduction);
  const rateLimitWindow = parsePositiveInt(env.RATE_LIMIT_WINDOW_MS, 60_000);

  if (isProduction) {
    if (
      !env.JWT_SECRET ||
      jwtSecret === DEFAULT_JWT_SECRET ||
      jwtSecret.length < 32
    ) {
      throw new Error(
        'JWT_SECRET must be configured with at least 32 characters in production',
      );
    }
    if (
      !env.ENCRYPTION_KEY ||
      encryptionKey === DEFAULT_ENCRYPTION_KEY ||
      !/^[a-fA-F0-9]{64}$/.test(encryptionKey)
    ) {
      throw new Error(
        'ENCRYPTION_KEY must be exactly 64 hexadecimal characters in production',
      );
    }
  }

  return {
    isProduction,
    corsOrigins,
    jwtSecret,
    encryptionKey,
    bodyLimit: 1_048_576,
    trustProxy: parseTrustProxyHops(env.TRUST_PROXY_HOPS),
    rateLimit: {
      max: parsePositiveInt(env.RATE_LIMIT_MAX, 100),
      timeWindow: rateLimitWindow,
    },
    healthRateLimit: {
      max: parsePositiveInt(env.HEALTH_RATE_LIMIT_MAX, 1_000),
      timeWindow: rateLimitWindow,
    },
  };
}

export function createFastifyAdapter(config: SecurityConfig): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: config.bodyLimit,
    trustProxy: config.trustProxy,
  });
}

export async function configureAppSecurity(
  app: NestFastifyApplication,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SecurityConfig> {
  const config = readSecurityConfig(env);

  await app.register(helmet, {
    contentSecurityPolicy: config.isProduction,
  });
  await app.register(rateLimit, {
    max: (request) =>
      isHealthRequest(request.url)
        ? config.healthRateLimit.max
        : config.rateLimit.max,
    timeWindow: (request) =>
      isHealthRequest(request.url)
        ? config.healthRateLimit.timeWindow
        : config.rateLimit.timeWindow,
    keyGenerator: (request) => request.ip,
  });
  app.enableCors({
    origin: config.corsOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  return config;
}

function parseOrigins(
  value: string | undefined,
  isProduction: boolean,
): string[] {
  if (!value?.trim()) {
    if (isProduction)
      throw new Error('CORS_ORIGINS must be configured in production');
    return ['http://localhost:3001'];
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.includes('*')) {
    throw new Error('CORS_ORIGINS must contain explicit HTTP(S) origins');
  }
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== origin
    ) {
      throw new Error('CORS_ORIGINS must contain explicit HTTP(S) origins');
    }
  }
  return origins;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('Rate-limit values must be positive integers');
  }
  return parsed;
}

function parseTrustProxyHops(value: string | undefined): number | false {
  if (!value || value === '0') return false;
  return parsePositiveInt(value, 1);
}

function isHealthRequest(url: string): boolean {
  return url === '/health' || url.startsWith('/health?');
}

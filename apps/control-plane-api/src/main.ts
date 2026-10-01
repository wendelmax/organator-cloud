import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { apiDocsEnabled, setupApiDocs } from './common/openapi';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import {
  configureAppSecurity,
  createFastifyAdapter,
  readSecurityConfig,
} from './common/security.config';
import {
  createAppLogger,
  readLoggingConfig,
  registerRequestIdHeader,
} from './common/logging.config';

async function bootstrap() {
  const logging = readLoggingConfig();
  const security = readSecurityConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(security, logging),
    { rawBody: true, logger: createAppLogger(logging) },
  );

  await configureAppSecurity(app);
  registerRequestIdHeader(app);
  if (apiDocsEnabled()) {
    // UI em /docs e especificação em /docs/openapi.json (e .yaml).
    setupApiDocs(app, readPackageVersion());
  }
  // SIGTERM/SIGINT: fecha o servidor HTTP e roda onModuleDestroy (Prisma, Redis, filas).
  app.enableShutdownHooks();

  // Fastify escuta na porta 3000 por padrão, configurando 0.0.0.0 para funcionar bem com Docker
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}

bootstrap().catch((err: unknown) => {
  // Falha de configuração/conexão no boot: registra e encerra com código != 0.
  createAppLogger(readLoggingConfigSafe()).fatal(
    err instanceof Error ? err.message : String(err),
    err instanceof Error ? err.stack : undefined,
    'Bootstrap',
  );
  process.exit(1);
});

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readLoggingConfigSafe() {
  try {
    return readLoggingConfig();
  } catch {
    return { format: 'json' as const, level: 'info' as const };
  }
}

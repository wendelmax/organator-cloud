import { NestFactory } from '@nestjs/core';
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

function readLoggingConfigSafe() {
  try {
    return readLoggingConfig();
  } catch {
    return { format: 'json' as const, level: 'info' as const };
  }
}

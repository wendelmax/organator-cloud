import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import {
  configureAppSecurity,
  createFastifyAdapter,
  readSecurityConfig,
} from './common/security.config';

async function bootstrap() {
  const security = readSecurityConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(security),
    { rawBody: true },
  );

  await configureAppSecurity(app);

  // Fastify escuta na porta 3000 por padrão, configurando 0.0.0.0 para funcionar bem com Docker
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();

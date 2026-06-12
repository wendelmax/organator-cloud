import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );
  
  // Opcional: configurar CORS globalmente se desejar
  app.enableCors();

  // Fastify escuta na porta 3000 por padrão, configurando 0.0.0.0 para funcionar bem com Docker
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();

import { randomUUID } from 'node:crypto';
import { ConsoleLogger, LogLevel } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const;
type Level = (typeof LEVELS)[number];

export interface LoggingConfig {
  /** json: uma linha JSON por evento (padrão em produção); pretty: texto colorido. */
  format: 'json' | 'pretty';
  level: Level;
}

export function readLoggingConfig(
  env: NodeJS.ProcessEnv = process.env,
): LoggingConfig {
  const format =
    env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'pretty');
  if (format !== 'json' && format !== 'pretty') {
    throw new Error('LOG_FORMAT must be json or pretty');
  }
  const level = (env.LOG_LEVEL ?? 'info') as Level;
  if (!LEVELS.includes(level)) {
    throw new Error(`LOG_LEVEL must be one of ${LEVELS.join(', ')}`);
  }
  return { format, level };
}

/** Níveis do logger do Nest equivalentes ao LOG_LEVEL. */
export function nestLogLevels(level: Level): LogLevel[] {
  const order: LogLevel[][] = [
    ['fatal', 'error'],
    ['warn'],
    ['log'],
    ['debug'],
    ['verbose'],
  ];
  return order.slice(0, LEVELS.indexOf(level) + 1).flat();
}

export function createAppLogger(config: LoggingConfig): ConsoleLogger {
  return new ConsoleLogger({
    json: config.format === 'json',
    colors: config.format === 'pretty',
    logLevels: nestLogLevels(config.level),
  });
}

/** Usa o X-Request-Id do cliente se for seguro; senão gera um UUID. */
export function resolveRequestId(req: IncomingMessage): string {
  const header = req.headers[REQUEST_ID_HEADER];
  return typeof header === 'string' && SAFE_REQUEST_ID.test(header)
    ? header
    : randomUUID();
}

/** Opções do Fastify: request id e, no formato json, log de acesso (pino). */
export function fastifyLoggingOptions(config: LoggingConfig) {
  return {
    requestIdHeader: false as const,
    genReqId: resolveRequestId,
    logger: config.format === 'json' ? { level: config.level } : false,
  };
}

/** Devolve o request id na resposta para correlacionar cliente e logs. */
export function registerRequestIdHeader(app: NestFastifyApplication): void {
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply) => {
      reply.header(REQUEST_ID_HEADER, request.id);
    });
}

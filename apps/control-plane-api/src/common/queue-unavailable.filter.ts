import { ArgumentsHost, Catch, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

const REDIS_UNAVAILABLE = [
  /enableOfflineQueue/i, // "Stream isn't writeable and enableOfflineQueue options is false"
  /Connection is closed/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /MaxRetriesPerRequestError/i,
];

export function isQueueUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name}: ${error.message}`;
  return REDIS_UNAVAILABLE.some((pattern) => pattern.test(text));
}

/**
 * Redis/fila indisponível vira 503 com mensagem clara (o cliente pode tentar
 * de novo), em vez de 500 genérico. Demais erros seguem o tratamento padrão.
 */
@Catch()
export class QueueUnavailableFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(QueueUnavailableFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() === 'http' && isQueueUnavailableError(exception)) {
      this.logger.warn(`Fila indisponível: ${(exception as Error).message}`);
      const body = {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        message:
          'A fila de processamento está indisponível no momento. Tente novamente em instantes.',
      };
      this.httpAdapterHost!.httpAdapter.reply(
        host.switchToHttp().getResponse(),
        body,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      return;
    }
    super.catch(exception, host);
  }
}

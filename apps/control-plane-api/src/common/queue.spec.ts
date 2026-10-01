import { HttpStatus } from '@nestjs/common';
import { Job } from 'bullmq';
import { bullJobId } from './queue';
import {
  isQueueUnavailableError,
  QueueUnavailableFilter,
} from './queue-unavailable.filter';

/** Validação real de opções do BullMQ (a mesma de Queue.add), sem Redis. */
function bullmqAccepts(jobId: string): void {
  // Chamado com um `this` mínimo de propósito (evita instanciar Queue/Redis).
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const validateOptions = (
    Job.prototype as unknown as {
      validateOptions(this: { opts: object }, data: string): void;
    }
  ).validateOptions;
  validateOptions.call({ opts: { jobId } }, '{}');
}

describe('bullJobId', () => {
  const keys = [
    'tenant-infra:t1',
    'tenant-deprovision:t1',
    'data-isolation:t1:generation:4',
    'plan-migration:t1:pro',
    'deploy-tenant-infra:t1:1790000000000',
  ];

  it.each(keys)('produces an id BullMQ accepts for %s', (key) => {
    expect(() => bullmqAccepts(bullJobId(key))).not.toThrow();
  });

  it('documents why: BullMQ rejects the raw idempotency keys', () => {
    expect(() => bullmqAccepts('tenant-infra:t1')).toThrow(
      'Custom Id cannot contain :',
    );
    expect(() => bullmqAccepts('data-isolation:t1:generation:4')).toThrow(
      'Custom Id cannot contain :',
    );
  });

  it('is deterministic so BullMQ deduplication keeps working', () => {
    expect(bullJobId('tenant-infra:t1')).toBe('tenant-infra__t1');
    expect(bullJobId('tenant-infra:t1')).toBe(bullJobId('tenant-infra:t1'));
  });
});

describe('QueueUnavailableFilter', () => {
  it.each([
    "Stream isn't writeable and enableOfflineQueue options is false",
    'Connection is closed.',
    'connect ECONNREFUSED 127.0.0.1:6379',
    'getaddrinfo ENOTFOUND redis',
  ])('recognizes Redis outages: %s', (message) => {
    expect(isQueueUnavailableError(new Error(message))).toBe(true);
  });

  it('ignores unrelated errors and non-errors', () => {
    expect(isQueueUnavailableError(new Error('Tenant not found'))).toBe(false);
    expect(isQueueUnavailableError('ECONNREFUSED')).toBe(false);
  });

  it('answers 503 with a retryable message for queue outages', () => {
    const reply = jest.fn();
    const filter = new QueueUnavailableFilter();
    (filter as unknown as { httpAdapterHost: unknown }).httpAdapterHost = {
      httpAdapter: { reply },
    };
    const response = {};
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({ getResponse: () => response }),
    } as never;

    filter.catch(new Error('Connection is closed.'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: expect.stringContaining('Tente novamente'),
      }),
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });
});

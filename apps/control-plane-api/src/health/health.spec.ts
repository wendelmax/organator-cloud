const ping = jest.fn();
const quit = jest.fn().mockResolvedValue('OK');
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({ ping, quit })),
);

import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';

describe('Health readiness', () => {
  let prisma: { $queryRaw: jest.Mock };
  let service: HealthService;
  let controller: HealthController;

  beforeEach(() => {
    jest.useRealTimers();
    ping.mockReset().mockResolvedValue('PONG');
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    service = new HealthService(prisma as never);
    controller = new HealthController(service);
  });

  it('is ready when Postgres and Redis respond', async () => {
    const result = await controller.ready();
    expect(result.status).toBe('ready');
    expect(result.checks.database.ok).toBe(true);
    expect(result.checks.redis.ok).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('returns 503 when the database is down, without leaking error details', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED postgres://admin:secret@db:5432'),
    );
    const error = await controller.ready().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const body = (error as ServiceUnavailableException).getResponse();
    expect(body).toMatchObject({
      status: 'not_ready',
      checks: { database: { ok: false }, redis: { ok: true } },
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('is not ready when Redis is down', async () => {
    ping.mockRejectedValue(new Error('Connection is closed'));
    await expect(service.readiness()).resolves.toMatchObject({
      status: 'not_ready',
      checks: { redis: { ok: false } },
    });
  });

  it('times out hanging dependencies after 2s', async () => {
    jest.useFakeTimers();
    prisma.$queryRaw.mockReturnValue(new Promise(() => undefined));
    const pending = service.readiness();
    await jest.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toMatchObject({
      checks: { database: { ok: false } },
    });
  });

  it('reuses one Redis client and closes it on shutdown', async () => {
    const Redis = jest.requireMock('ioredis');
    Redis.mockClear();
    await service.readiness();
    await service.readiness();
    expect(Redis).toHaveBeenCalledTimes(1);
    expect(Redis).toHaveBeenCalledWith(
      expect.objectContaining({ lazyConnect: true, enableOfflineQueue: false }),
    );
    await service.onModuleDestroy();
    expect(quit).toHaveBeenCalled();
  });
});

const redisInstances: any[] = [];
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const instance = {
      subscribeError: undefined as Error | undefined,
      subscribe: jest.fn((_ch: string, cb: (err?: Error) => void) => cb(instance.subscribeError)),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, h: any) => (handlers[event] = h)),
      off: jest.fn(),
      emit: (event: string, ...args: any[]) => handlers[event]?.(...args),
    };
    redisInstances.push(instance);
    return instance;
  }),
);

import { DataIsolationEventsService } from './data-isolation-events.service';

describe('DataIsolationEventsService — streaming', () => {
  let prisma: any;
  let service: DataIsolationEventsService;

  beforeEach(() => {
    jest.useFakeTimers();
    redisInstances.length = 0;
    prisma = { deployment: { findFirst: jest.fn().mockResolvedValue({ id: 'dep-1' }) } };
    service = new DataIsolationEventsService(prisma);
  });

  afterEach(() => jest.useRealTimers());

  it('checks ownership using both deployment id and tenant id', async () => {
    await service.stream({ tenantId: 't1', deploymentId: 'dep-1' });
    expect(prisma.deployment.findFirst).toHaveBeenCalledWith({ where: { id: 'dep-1', tenantId: 't1' } });
  });

  it('emits parsed events for the tenant channel only, skipping malformed payloads', async () => {
    const events: any[] = [];
    const obs = await service.stream({ tenantId: 't1', deploymentId: 'dep-1' });
    const sub = obs.subscribe((e) => events.push(e.data));
    const redis = redisInstances[0];

    expect(redis.subscribe).toHaveBeenCalledWith('data_isolation:t1:dep-1', expect.any(Function));
    redis.emit('message', 'data_isolation:t1:dep-1', JSON.stringify({ phase: 'MIGRATE', status: 'RUNNING' }));
    redis.emit('message', 'data_isolation:t2:dep-1', JSON.stringify({ phase: 'LEAK' }));
    redis.emit('message', 'data_isolation:t1:dep-1', '{not json');

    expect(events).toEqual([{ phase: 'MIGRATE', status: 'RUNNING' }]);
    sub.unsubscribe();
  });

  it('sends a heartbeat every 15s and stops after unsubscribe', async () => {
    const events: any[] = [];
    const obs = await service.stream({ tenantId: 't1', deploymentId: 'dep-1' });
    const sub = obs.subscribe((e) => events.push(e.data));

    jest.advanceTimersByTime(15000);
    expect(events).toEqual([expect.objectContaining({ phase: 'HEARTBEAT', status: 'PING', deploymentId: 'dep-1' })]);

    sub.unsubscribe();
    jest.advanceTimersByTime(60000);
    expect(events).toHaveLength(1);
    const redis = redisInstances[0];
    expect(redis.unsubscribe).toHaveBeenCalledWith('data_isolation:t1:dep-1');
    expect(redis.quit).toHaveBeenCalled();
  });

  it('propagates redis subscribe errors to the subscriber', async () => {
    const obs = await service.stream({ tenantId: 't1', deploymentId: 'dep-1' });
    const Redis = jest.requireMock('ioredis');
    Redis.mockImplementationOnce(() => {
      const inst: any = {
        subscribe: jest.fn((_c: string, cb: (e?: Error) => void) => cb(new Error('NOAUTH'))),
        on: jest.fn(),
        off: jest.fn(),
        unsubscribe: jest.fn().mockResolvedValue(undefined),
        quit: jest.fn().mockResolvedValue(undefined),
      };
      return inst;
    });
    const error = jest.fn();
    obs.subscribe({ error });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'NOAUTH' }));
  });
});

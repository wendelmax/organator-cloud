import { NotFoundException } from '@nestjs/common';
const redisInstances: any[] = [];
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const instance = {
      subscribe: jest.fn((_channel: string, cb?: (err?: Error) => void) =>
        cb?.(),
      ),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, handler: any) => {
        handlers[event] = handler;
      }),
      off: jest.fn((event: string) => {
        delete handlers[event];
      }),
      emit: (event: string, ...args: any[]) => handlers[event]?.(...args),
    };
    redisInstances.push(instance);
    return instance;
  });
});

import { ServicesService } from './services.service';

describe('ServicesService', () => {
  let prisma: any;
  let queue: any;
  let providers: any;
  let service: ServicesService;

  beforeEach(() => {
    redisInstances.length = 0;
    prisma = {
      microservice: {
        create: jest.fn((args) =>
          Promise.resolve({ id: 'svc-1', ...args.data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      deployment: {
        create: jest.fn((args) =>
          Promise.resolve({ id: 'dep-1', ...args.data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    providers = { resolveForDeploy: jest.fn().mockResolvedValue(undefined) };
    service = new ServicesService(prisma, queue, providers);
  });

  it('creates a microservice for the tenant', async () => {
    const result = await service.createService(
      't1',
      'api',
      'VERCEL',
      'git@x/y',
    );
    expect(prisma.microservice.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        name: 'api',
        cloudProvider: 'VERCEL',
        repository: 'git@x/y',
        image: null,
        vpsHost: null,
      },
    });
    expect(result.id).toBe('svc-1');
  });

  it('lists services scoped by tenant', async () => {
    await service.getServicesByTenant('t1');
    expect(prisma.microservice.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
    });
  });

  describe('tenant scope', () => {
    it('hides services and deployments of another tenant (404)', async () => {
      prisma.microservice.findUnique.mockResolvedValue({
        id: 'svc-1',
        tenantId: 't-a',
      });
      await expect(
        service.getDeploymentsByService('svc-1', 't-b'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.triggerDeploy('svc-1', 'production', 't-b'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.deployment.findMany).not.toHaveBeenCalled();
      expect(prisma.deployment.create).not.toHaveBeenCalled();
    });

    it('checks the tenant of a deployment before streaming its logs', async () => {
      prisma.deployment.findUnique = jest
        .fn()
        .mockResolvedValueOnce({
          tenantId: null,
          microservice: { tenantId: 't-a' },
        })
        .mockResolvedValueOnce({
          tenantId: null,
          microservice: { tenantId: 't-a' },
        })
        .mockResolvedValueOnce(null);

      await expect(
        service.assertDeploymentInScope('dep-1', 't-a'),
      ).resolves.toBeUndefined();
      await expect(
        service.assertDeploymentInScope('dep-1', 't-b'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.assertDeploymentInScope('missing', null),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('lists deployments newest first', async () => {
    prisma.microservice.findUnique.mockResolvedValue({
      id: 'svc-1',
      tenantId: 't-a',
    });
    await service.getDeploymentsByService('svc-1');
    expect(prisma.deployment.findMany).toHaveBeenCalledWith({
      where: { microserviceId: 'svc-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  describe('triggerDeploy', () => {
    const svc = { id: 'svc-1', cloudProvider: 'VERCEL', repository: 'repo' };

    it('rejects unknown environments before touching the database', async () => {
      await expect(service.triggerDeploy('svc-1', 'qa')).rejects.toThrow(
        /environment/,
      );
      expect(prisma.microservice.findUnique).not.toHaveBeenCalled();
    });

    it('fails when the service does not exist', async () => {
      prisma.microservice.findUnique.mockResolvedValue(null);
      await expect(service.triggerDeploy('missing')).rejects.toThrow(
        'Service not found',
      );
    });

    it('creates a PENDING deployment in production by default and enqueues the job', async () => {
      prisma.microservice.findUnique.mockResolvedValue(svc);
      const dep = await service.triggerDeploy('svc-1');

      expect(dep).toMatchObject({
        status: 'PENDING',
        environment: 'production',
      });
      expect(queue.add).toHaveBeenCalledWith('deploy-microservice', {
        serviceId: 'svc-1',
        provider: 'VERCEL',
        repo: 'repo',
        deploymentId: 'dep-1',
        environment: 'production',
      });
    });

    it('injects resolved provider credentials into the job payload', async () => {
      prisma.microservice.findUnique.mockResolvedValue(svc);
      providers.resolveForDeploy.mockResolvedValue({ apiToken: 'tok' });

      await service.triggerDeploy('svc-1', 'staging');

      expect(providers.resolveForDeploy).toHaveBeenCalledWith('VERCEL');
      expect(queue.add).toHaveBeenCalledWith(
        'deploy-microservice',
        expect.objectContaining({
          environment: 'staging',
          credentials: { apiToken: 'tok' },
        }),
      );
    });

    it('marks the deployment FAILED when enqueueing fails (never stuck PENDING)', async () => {
      prisma.microservice.findUnique.mockResolvedValue(svc);
      queue.add.mockRejectedValue(new Error('redis down'));
      prisma.deployment.update = jest.fn(({ data }) =>
        Promise.resolve({ id: 'dep-1', ...data }),
      );
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(service.triggerDeploy('svc-1')).resolves.toMatchObject({
        id: 'dep-1',
        status: 'FAILED',
      });
      expect(prisma.deployment.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: {
          status: 'FAILED',
          logs: expect.stringContaining(
            'Não foi possível enfileirar o deploy: redis down',
          ),
        },
      });
      warn.mockRestore();
    });

    it('works without a queue configured', async () => {
      const noQueue = new ServicesService(prisma);
      prisma.microservice.findUnique.mockResolvedValue(svc);
      await expect(
        noQueue.triggerDeploy('svc-1', 'development'),
      ).resolves.toMatchObject({
        environment: 'development',
      });
    });
  });

  describe('streamDeploymentLogs', () => {
    it('forwards only messages from the deployment channel and cleans up on unsubscribe', () => {
      const received: string[] = [];
      const sub = service
        .streamDeploymentLogs('dep-9')
        .subscribe((e) => received.push(e.data));
      const redis = redisInstances[0];

      expect(redis.subscribe).toHaveBeenCalledWith(
        'deploy_logs:dep-9',
        expect.any(Function),
      );
      redis.emit('message', 'deploy_logs:dep-9', 'line 1');
      redis.emit('message', 'deploy_logs:other', 'ignored');
      redis.emit('message', 'deploy_logs:dep-9', 'line 2');
      expect(received).toEqual(['line 1', 'line 2']);

      sub.unsubscribe();
      expect(redis.off).toHaveBeenCalledWith('message', expect.any(Function));
      expect(redis.unsubscribe).toHaveBeenCalledWith('deploy_logs:dep-9');
      expect(redis.quit).toHaveBeenCalled();
    });
  });
});

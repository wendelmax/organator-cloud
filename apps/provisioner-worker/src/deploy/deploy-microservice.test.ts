import test, { describe, mock, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import Tasklets from '@wendelmax/tasklets';
import { VercelClient, VPSClient } from '@organator/cloud-providers';
import {
  sanitizeLogLine,
  createDeployLogger,
  createDeploymentStatusUpdater,
  handleDeployMicroservice,
} from './deploy-microservice.js';

after(() => Tasklets.shutdown());

beforeEach(() => {
  mock.method(console, 'log', () => {});
  mock.method(console, 'warn', () => {});
});
afterEach(() => mock.restoreAll());

const fakeJob = (data: Record<string, unknown> = {}) => {
  const logs: string[] = [];
  return { data, logs, log: async (m: string) => void logs.push(m) } as any;
};

describe('sanitizeLogLine', () => {
  test('redacts Stripe-style keys, private keys, passwords and tokens', async () => {
    const line = [
      'key=sk_live_ABCDEF1234567890',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
      'password: "hunter2"',
      'token="abc.def"',
    ].join(' | ');
    const out = await sanitizeLogLine(line);

    for (const secret of ['ABCDEF1234567890', 'MIIEow', 'hunter2', 'abc.def']) {
      assert.ok(!out.includes(secret), `leaked ${secret}: ${out}`);
    }
    assert.match(out, /\[REDACTED\]/);
  });

  test('keeps innocuous lines intact', async () => {
    assert.equal(await sanitizeLogLine('[Deploy] ok\n'), '[Deploy] ok\n');
  });

  test('truncates lines larger than 16KiB', async () => {
    const out = await sanitizeLogLine('x'.repeat(20 * 1024));
    assert.ok(out.endsWith('\n[TRUNCATED]\n'));
    assert.equal(out.length, 16 * 1024 + '\n[TRUNCATED]\n'.length);
  });

  test('still redacts when the worker thread fails', async () => {
    mock.method(Tasklets, 'run', async () => {
      throw new Error('worker crashed');
    });
    const out = await sanitizeLogLine('leak sk_test_SECRETSECRET123');
    assert.ok(!out.includes('SECRETSECRET123'));
    assert.match(out, /\[REDACTED\]/);
  });
});

describe('createDeployLogger', () => {
  function deps(current: string | null = 'previous\n') {
    const updates: any[] = [];
    const published: any[] = [];
    const prisma = {
      deployment: {
        findUnique: async () => (current === null ? null : { logs: current }),
        update: async (args: any) => void updates.push(args),
      },
    } as any;
    const redis = { publish: async (...args: any[]) => void published.push(args) } as any;
    return { prisma, redis, updates, published };
  }

  test('appends sanitized lines to the deployment and publishes them for SSE', async () => {
    const { prisma, redis, updates, published } = deps();
    const job = fakeJob();
    await createDeployLogger(prisma, redis)('dep-1', job, 'using sk_live_ABCDEFGHIJKLMN', 'SUCCESS');

    assert.deepEqual(job.logs, ['using sk_live_ABCDEFGHIJKLMN']);
    const data = updates[0].data;
    assert.ok(data.logs.startsWith('previous\n['));
    assert.ok(!data.logs.includes('ABCDEFGHIJKLMN'));
    assert.equal(data.phase, 'SUCCESS');

    const [channel, payload] = published[0];
    assert.equal(channel, 'deploy_logs:dep-1');
    const parsed = JSON.parse(payload);
    assert.equal(parsed.status, 'SUCCESS');
    assert.ok(!parsed.logLine.includes('ABCDEFGHIJKLMN'));
  });

  test('defaults status to RUNNING and handles empty logs', async () => {
    const { prisma, redis, updates } = deps(null);
    await createDeployLogger(prisma, redis)('dep-1', fakeJob(), 'hello');
    assert.equal(updates[0].data.phase, 'RUNNING');
    assert.match(updates[0].data.logs, /^\[.+\] hello\n$/);
  });

  test('only logs to the job when there is no deployment', async () => {
    const { prisma, redis, updates, published } = deps();
    const job = fakeJob();
    await createDeployLogger(prisma, redis)(null, job, 'hi');
    assert.deepEqual(job.logs, ['hi']);
    assert.equal(updates.length + published.length, 0);
  });

  test('does not fail the deploy if persisting the log fails', async () => {
    const { redis } = deps();
    const prisma = { deployment: { findUnique: async () => { throw new Error('db down'); } } } as any;
    await assert.doesNotReject(createDeployLogger(prisma, redis)('dep-1', fakeJob(), 'x'));
  });
});

describe('handleDeployMicroservice', () => {
  test('deploys to Vercel with the job credentials', async () => {
    const created = mock.method(VercelClient.prototype, 'createProject', async () => ({ id: 'prj_1' }));
    const env = mock.method(VercelClient.prototype, 'injectEnvVar', async () => true);
    mock.method(VercelClient.prototype, 'createDeployment', async () => 'https://svc.vercel.app');
    const lines: string[] = [];

    await handleDeployMicroservice(
      fakeJob({ serviceId: 's1', provider: 'VERCEL', repo: 'acme/app', credentials: { secrets: { apiToken: 'tok' } } }),
      'dep-1',
      async (_d, _j, msg) => void lines.push(msg),
    );

    assert.deepEqual(created.mock.calls[0].arguments, ['service-s1', 'acme/app']);
    assert.deepEqual(env.mock.calls[0].arguments, ['prj_1', 'SERVICE_ID', 's1']);
    assert.deepEqual(lines, ['[Deploy] Serviço s1 -> Nuvem: VERCEL', '[Vercel] Build completo: https://svc.vercel.app']);
  });

  test('deploys to a VPS parsing user@host', async () => {
    const deploy = mock.method(VPSClient.prototype, 'deployDockerContainer', async () => 'container-id');
    const lines: string[] = [];

    await handleDeployMicroservice(
      fakeJob({ serviceId: 's2', provider: 'VPS', vpsHost: 'deploy@10.0.0.5', image: 'ghcr.io/acme/api:1' }),
      null,
      async (_d, _j, msg) => void lines.push(msg),
    );

    assert.deepEqual(deploy.mock.calls[0].arguments, ['ghcr.io/acme/api:1', 'service-s2', { PORT: '80' }, 'service-s2.organator.local']);
    assert.match(lines[1], /implantada com sucesso em 10\.0\.0\.5\. Resultado: container-id/);
  });

  test('fails providers without automated deploy instead of reporting success', async () => {
    const lines: string[] = [];
    const statuses: string[] = [];
    await assert.rejects(
      handleDeployMicroservice(
        fakeJob({ serviceId: 's3', provider: 'AWS' }),
        'dep-3',
        async (_d, _j, m) => void lines.push(m),
        async (_d, status) => void statuses.push(status),
      ),
      /não suportado para o provedor AWS/,
    );
    assert.deepEqual(statuses, ['RUNNING', 'FAILED']);
    assert.ok(lines.at(-1)!.startsWith('[Deploy] Falhou: '));
  });

  test('fails a VPS deploy without an image instead of publishing a default one', async () => {
    const deploy = mock.method(VPSClient.prototype, 'deployDockerContainer', async () => 'ok');
    const statuses: string[] = [];
    await assert.rejects(
      handleDeployMicroservice(
        fakeJob({ serviceId: 's6', provider: 'DOCKER_VPS', vpsHost: 'root@h' }),
        'dep-6',
        async () => {},
        async (_d, status) => void statuses.push(status),
      ),
      /sem imagem Docker/,
    );
    assert.equal(deploy.mock.callCount(), 0);
    assert.deepEqual(statuses, ['RUNNING', 'FAILED']);
  });

  test('records RUNNING then SUCCESS on a successful deploy', async () => {
    mock.method(VPSClient.prototype, 'deployDockerContainer', async () => 'ok');
    const statuses: string[] = [];
    await handleDeployMicroservice(
      fakeJob({ serviceId: 's4', provider: 'VPS', vpsHost: 'root@h', image: 'nginx:alpine' }),
      'dep-4',
      async () => {},
      async (_d, status) => void statuses.push(status),
    );
    assert.deepEqual(statuses, ['RUNNING', 'SUCCESS']);
  });

  test('records FAILED and rethrows when the provider fails (job is marked failed)', async () => {
    mock.method(VercelClient.prototype, 'createProject', async () => {
      throw new Error('[Vercel] create project service-s5 failed: 401');
    });
    const statuses: string[] = [];
    const lines: string[] = [];
    await assert.rejects(
      handleDeployMicroservice(
        fakeJob({ serviceId: 's5', provider: 'VERCEL', repo: 'r' }),
        'dep-5',
        async (_d, _j, m) => void lines.push(m),
        async (_d, status) => void statuses.push(status),
      ),
      /401/,
    );
    assert.deepEqual(statuses, ['RUNNING', 'FAILED']);
    assert.ok(!lines.some((l) => l.includes('Build completo')));
  });
});

describe('createDeploymentStatusUpdater', () => {
  test('updates the deployment status and tolerates database errors', async () => {
    const updates: any[] = [];
    const ok = createDeploymentStatusUpdater({ deployment: { update: async (a: any) => void updates.push(a) } } as any);
    await ok('dep-1', 'SUCCESS');
    await ok(null, 'SUCCESS');
    assert.deepEqual(updates, [{ where: { id: 'dep-1' }, data: { status: 'SUCCESS' } }]);

    mock.method(console, 'warn', () => {});
    const broken = createDeploymentStatusUpdater({ deployment: { update: async () => { throw new Error('db'); } } } as any);
    await assert.doesNotReject(broken('dep-1', 'FAILED'));
  });
});

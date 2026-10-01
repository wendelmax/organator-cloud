import test, { describe, mock, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import Tasklets from '@wendelmax/tasklets';
import { VercelClient, VPSClient } from '@organator/cloud-providers';
import { sanitizeLogLine, createDeployLogger, handleDeployMicroservice } from './deploy-microservice.js';

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
      fakeJob({ serviceId: 's2', provider: 'VPS', vpsHost: 'deploy@10.0.0.5' }),
      null,
      async (_d, _j, msg) => void lines.push(msg),
    );

    assert.deepEqual(deploy.mock.calls[0].arguments, ['nginx:alpine', 'service-s2', { PORT: '80' }, 'service-s2.organator.local']);
    assert.match(lines[1], /implantada com sucesso em 10\.0\.0\.5\. Resultado: container-id/);
  });

  test('only logs the start for other providers', async () => {
    const lines: string[] = [];
    await handleDeployMicroservice(fakeJob({ serviceId: 's3', provider: 'AWS' }), null, async (_d, _j, m) => void lines.push(m));
    assert.deepEqual(lines, ['[Deploy] Serviço s3 -> Nuvem: AWS']);
  });
});

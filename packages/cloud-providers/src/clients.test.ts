import test, { describe, mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { EC2Client } from '@aws-sdk/client-ec2';
import { encryptSecret } from './crypto.js';
import { VercelClient } from './vercel.js';
import { AWSClient } from './aws.js';
import { VPSClient } from './vps.js';

beforeEach(() => {
  mock.method(console, 'log', () => {});
  mock.method(console, 'warn', () => {});
});
afterEach(() => mock.restoreAll());

describe('VercelClient', () => {
  test('decrypts the token and scopes requests to the team', async () => {
    const post = mock.method(axios, 'post', async () => ({ data: { id: 'prj_1', url: 'app-abc.vercel.app' } }));
    const client = new VercelClient(encryptSecret('tok'), encryptSecret('team_1'));

    assert.deepEqual(await client.createProject('app', 'acme/app'), { id: 'prj_1', url: 'app-abc.vercel.app' });
    assert.equal(await client.injectEnvVar('prj_1', 'DB_URL', 'postgres://'), true);
    assert.equal(await client.createDeployment('prj_1'), 'app-abc.vercel.app');

    const [projUrl, projBody, projOpts] = post.mock.calls[0].arguments as any[];
    assert.equal(projUrl, 'https://api.vercel.com/v9/projects?teamId=team_1');
    assert.deepEqual(projBody, { name: 'app', gitRepository: { type: 'github', repo: 'acme/app' } });
    assert.equal(projOpts.headers.Authorization, 'Bearer tok');

    const [envUrl, envBody] = post.mock.calls[1].arguments as any[];
    assert.equal(envUrl, 'https://api.vercel.com/v9/projects/prj_1/env?teamId=team_1');
    assert.deepEqual(envBody, { key: 'DB_URL', value: 'postgres://', type: 'encrypted', target: ['production'] });

    assert.equal((post.mock.calls[2].arguments as any[])[0], 'https://api.vercel.com/v13/deployments?teamId=team_1');
  });

  test('omits teamId when not configured', async () => {
    const post = mock.method(axios, 'post', async () => ({ data: {} }));
    await new VercelClient('tok').createProject('app', 'r');
    assert.equal((post.mock.calls[0].arguments as any[])[0], 'https://api.vercel.com/v9/projects');
  });

  test('falls back to deterministic values when the API fails', async () => {
    mock.method(axios, 'post', async () => {
      throw new Error('401');
    });
    const client = new VercelClient('tok');
    assert.deepEqual(await client.createProject('app', 'r'), { id: 'prj_app', name: 'app' });
    assert.equal(await client.injectEnvVar('p', 'K', 'V'), true);
    assert.equal(await client.createDeployment('p'), 'https://p.vercel.app');
  });
});

describe('AWSClient', () => {
  test('returns the launched instance id', async () => {
    const send = mock.method(EC2Client.prototype, 'send', async () => ({ Instances: [{ InstanceId: 'i-123' }] }));
    const client = new AWSClient('eu-west-1', encryptSecret('AKIA'), encryptSecret('secret'));

    assert.equal(await client.createEC2Instance('ami-1', 't3.small'), 'i-123');
    const cmd = (send.mock.calls[0].arguments as any[])[0];
    assert.deepEqual(cmd.input, { ImageId: 'ami-1', InstanceType: 't3.small', MinCount: 1, MaxCount: 1 });
  });

  test('applies default AMI/instance type and falls back to a mock id on errors', async () => {
    const send = mock.method(EC2Client.prototype, 'send', async () => {
      throw new Error('AuthFailure');
    });
    const id = await new AWSClient('', '', '').createEC2Instance('', '');
    assert.match(id, /^i-ec2-\d+$/);
    const cmd = (send.mock.calls[0].arguments as any[])[0];
    assert.equal(cmd.input.InstanceType, 't2.micro');
    assert.ok(cmd.input.ImageId.startsWith('ami-'));
  });
});

describe('VPSClient', () => {
  test('skips real SSH for demo/missing keys', async () => {
    assert.equal(await new VPSClient('h').execCommand('  uptime  '), '[Mock SSH Output] Executed: uptime');
    assert.match(await new VPSClient('h', 22, 'root', encryptSecret('mock-key')).execCommand('ls'), /Mock SSH Output/);
  });

  test('builds a docker run command with envs and Traefik routing labels', async () => {
    const client = new VPSClient('h');
    const exec = mock.method(client, 'execCommand', async (cmd: string) => cmd);

    await client.deployDockerContainer('ghcr.io/acme/app:1', 'acme-app', { NODE_ENV: 'production', PORT: '3000' }, 'app.acme.com');
    const cmd = (exec.mock.calls[0].arguments as any[])[0] as string;

    assert.match(cmd, /docker pull ghcr\.io\/acme\/app:1/);
    assert.match(cmd, /docker run -d --name acme-app --restart unless-stopped -e NODE_ENV=production -e PORT=3000/);
    assert.match(cmd, /traefik\.http\.routers\.acme-app\.rule=Host\(`app\.acme\.com`\)/);
  });

  test('falls back to a mock result when the deploy command throws', async () => {
    const client = new VPSClient('h');
    mock.method(client, 'execCommand', async () => {
      throw new Error('channel closed');
    });
    assert.equal(
      await client.deployDockerContainer('img', 'c', {}, 'd.com'),
      '[Mock Container Deploy] c deployed on d.com',
    );
  });
});

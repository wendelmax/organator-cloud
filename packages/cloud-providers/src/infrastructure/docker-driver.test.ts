import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DockerDriver } from './docker-driver.js';

describe('DockerDriver', () => {
  test('generates valid container name and connection string', async () => {
    const driver = new DockerDriver();
    const result = await driver.prepareDatabase({
      tenantId: 'tenant-123',
      slug: 'acme',
      isolationMode: 'DATABASE',
      environment: 'development',
    });

    assert.equal(result.databaseId, 'org_db_acme');
    assert.ok(result.connectionUrl.includes('postgresql://'));
  });

  test('prepares network and dns correctly', async () => {
    const driver = new DockerDriver();
    const spec = { tenantId: 'tenant-123', slug: 'acme', isolationMode: 'SHARED' as const, environment: 'development' };
    const net = await driver.prepareNetwork(spec);
    const dns = await driver.configureDNS(spec);

    assert.equal(net.networkId, 'org_net_acme');
    assert.equal(dns.dnsRecord, 'acme.organator.local');
  });
});

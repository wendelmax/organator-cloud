import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { AWSDriver } from './aws-driver.js';

describe('AWSDriver', () => {
  test('formats AWS resource names correctly', async () => {
    const driver = new AWSDriver('us-east-1');
    const db = await driver.prepareDatabase({
      tenantId: 'tenant-1',
      slug: 'acme',
      isolationMode: 'DATABASE',
      environment: 'production',
    });
    assert.equal(db.databaseId, 'org-rds-acme');
    assert.ok(db.connectionUrl.includes('rds.amazonaws.com'));
  });

  test('prepares AWS network and Route53 DNS', async () => {
    const driver = new AWSDriver('us-east-1');
    const spec = { tenantId: 'tenant-1', slug: 'acme', isolationMode: 'DATABASE' as const, environment: 'production' };
    const net = await driver.prepareNetwork(spec);
    const dns = await driver.configureDNS(spec);

    assert.equal(net.networkId, 'sg-org-acme');
    assert.equal(dns.dnsRecord, 'acme.organator.cloud');
  });
});

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { TerraformDriver } from './terraform-driver.js';

describe('TerraformDriver', () => {
  test('formats Terraform resource outputs correctly', async () => {
    const driver = new TerraformDriver();
    const spec = { tenantId: 'tenant-1', slug: 'acme', isolationMode: 'SCHEMA' as const, environment: 'production' };
    const db = await driver.prepareDatabase(spec);
    const net = await driver.prepareNetwork(spec);
    const dns = await driver.configureDNS(spec);

    assert.equal(db.databaseId, 'tf_db_acme');
    assert.equal(net.networkId, 'tf_net_acme');
    assert.equal(dns.dnsRecord, 'acme.tf.organator.cloud');
  });
});

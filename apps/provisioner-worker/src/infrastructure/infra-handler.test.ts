import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider } from './infra-handler.js';

describe('infra-handler', () => {
  test('resolves DockerDriver for local/vps provider', () => {
    const driver = resolveProvider('DOCKER');
    assert.equal(driver.name, 'DOCKER');
  });

  test('resolves AWSDriver for AWS provider', () => {
    const driver = resolveProvider('AWS');
    assert.equal(driver.name, 'AWS');
  });

  test('resolves TerraformDriver for TERRAFORM provider', () => {
    const driver = resolveProvider('TERRAFORM');
    assert.equal(driver.name, 'TERRAFORM');
  });
});

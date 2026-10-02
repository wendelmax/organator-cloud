import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { currentIsolation, isolationForPlan, resolveProvider } from './infra-handler.js';

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

  test('maps plan slugs to isolation regardless of case', () => {
    assert.equal(isolationForPlan('enterprise'), 'DATABASE');
    assert.equal(isolationForPlan('Enterprise'), 'DATABASE');
    assert.equal(isolationForPlan('pro'), 'SCHEMA');
    assert.equal(isolationForPlan('free'), 'SHARED');
    assert.equal(isolationForPlan(undefined), 'SHARED');
  });

  test('prefers the isolation in use over the plan default', async () => {
    const prisma = (activeIsolation: string | null, plan: string) =>
      ({
        tenantDataPlane: { findUnique: async () => (activeIsolation ? { activeIsolation } : null) },
        tenant: { findUnique: async () => ({ plan }) },
      }) as any;
    assert.equal(await currentIsolation(prisma('DATABASE', 'free'), 't-1'), 'DATABASE');
    assert.equal(await currentIsolation(prisma(null, 'pro'), 't-1'), 'SCHEMA');
  });
});

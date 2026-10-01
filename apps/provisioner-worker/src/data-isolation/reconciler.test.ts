import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IsolationError } from '@organator/data-isolation';
import { reconcileDataIsolation, ReconcilePayload } from './reconciler.js';
import type { IsolationSnapshot } from './repository.js';

type Call = [string, any?];

function makeRepository(snapshot: IsolationSnapshot | null, calls: Call[]) {
  return {
    withTenantLock: async (tenantId: string, fn: () => Promise<any>) => {
      calls.push(['lock', tenantId]);
      return fn();
    },
    load: async () => snapshot,
    checkpoint: async (input: any) => void calls.push(['checkpoint', input]),
    cutover: async (input: any) => void calls.push(['cutover', input]),
    fail: async (input: any) => void calls.push(['fail', input]),
    recordAudit: async (input: any) => void calls.push(['audit', input]),
  } as any;
}

function makeAdapter(calls: Call[], failAt?: string, error: unknown = new IsolationError('ISOLATION_COPY_FAILED' as any, 'copy failed')) {
  const step = (name: string, value?: any) => async () => {
    calls.push([`adapter.${name}`]);
    if (failAt === name) throw error;
    return value;
  };
  return {
    prepareTarget: step('prepareTarget', { mode: 'SCHEMA', resourceIds: { schema: 't_acme' } }),
    applyMigrations: step('applyMigrations'),
    copyData: step('copyData'),
    validate: step('validate'),
    activate: step('activate', {
      storedConnection: { reference: { id: 'ref-2', mode: 'SCHEMA' }, encryptedPayload: { url: 'enc' } },
      cleanupAfter: '2026-10-07T00:00:00.000Z',
    }),
    compensate: async () => void calls.push(['adapter.compensate']),
  } as any;
}

const snapshot = (overrides: Partial<IsolationSnapshot> = {}): IsolationSnapshot => ({
  tenantId: 't1',
  generation: 2,
  observedGeneration: 1,
  desiredMode: 'SCHEMA',
  activeIsolation: 'SHARED',
  status: 'RECONCILING',
  phase: 'PREPARE',
  resourceState: { database: 'organator', activeConnectionReference: 'ref-1' },
  encryptedConnection: { url: 'x' },
  lastError: null,
  ...overrides,
});

const payload: ReconcilePayload = { apiVersion: 'v1', tenantId: 't1', generation: 2, desiredMode: 'SCHEMA', deploymentId: 'dep-1' };

describe('reconcileDataIsolation', () => {
  let calls: Call[];
  beforeEach(() => {
    calls = [];
  });

  test('runs every phase in order under the tenant lock and cuts over', async () => {
    const result = await reconcileDataIsolation(makeRepository(snapshot(), calls), makeAdapter(calls), payload);

    assert.deepEqual(result, { status: 'SUCCESS' });
    assert.deepEqual(calls[0], ['lock', 't1']);
    const phases = calls.filter(([k]) => k === 'checkpoint').map(([, i]) => i.phase);
    assert.deepEqual(phases, ['PREPARE', 'PROVISION_TARGET', 'APPLY_MIGRATIONS', 'COPY', 'VALIDATE']);
    assert.deepEqual(
      calls.filter(([k]) => k.startsWith('adapter.')).map(([k]) => k),
      ['adapter.prepareTarget', 'adapter.applyMigrations', 'adapter.copyData', 'adapter.validate', 'adapter.activate'],
    );

    const cutover = calls.find(([k]) => k === 'cutover')![1];
    assert.equal(cutover.mode, 'SCHEMA');
    assert.equal(cutover.generation, 2);
    assert.equal(cutover.storedConnection.reference.id, 'ref-2');
    assert.equal(cutover.resourceState.schema, 't_acme');
    assert.equal(cutover.resourceState.cleanupAfter, '2026-10-07T00:00:00.000Z');

    const audit = calls.find(([k]) => k === 'audit')![1];
    assert.equal(audit.action, 'cutover_completed');
    assert.deepEqual(audit.changes, { sourceMode: 'SHARED', targetMode: 'SCHEMA' });
  });

  test('fails when the tenant has no data plane', async () => {
    const result = await reconcileDataIsolation(makeRepository(null, calls), makeAdapter(calls), payload);
    assert.equal(result.status, 'FAILED');
    assert.ok(!calls.some(([k]) => k.startsWith('adapter.')));
  });

  test('skips stale jobs whose generation does not match', async () => {
    const result = await reconcileDataIsolation(makeRepository(snapshot({ generation: 3 }), calls), makeAdapter(calls), payload);
    assert.equal(result.status, 'STALE');
    assert.ok(!calls.some(([k]) => k === 'checkpoint' || k.startsWith('adapter.')));
  });

  for (const failAt of ['applyMigrations', 'copyData', 'validate']) {
    test(`compensates the target and records failure when ${failAt} fails`, async () => {
      const result = await reconcileDataIsolation(makeRepository(snapshot(), calls), makeAdapter(calls, failAt), payload);

      assert.deepEqual(result, { status: 'FAILED', message: 'copy failed' });
      assert.ok(calls.some(([k]) => k === 'adapter.compensate'));
      assert.ok(!calls.some(([k]) => k === 'cutover'));
      const fail = calls.find(([k]) => k === 'fail')![1];
      assert.equal(fail.code, 'ISOLATION_COPY_FAILED');
      assert.equal(calls.find(([k]) => k === 'audit')![1].action, 'reconciliation_failed');
    });
  }

  test('does not compensate when prepareTarget fails (nothing to clean up)', async () => {
    await reconcileDataIsolation(makeRepository(snapshot(), calls), makeAdapter(calls, 'prepareTarget'), payload);
    assert.ok(!calls.some(([k]) => k === 'adapter.compensate'));
    assert.equal(calls.find(([k]) => k === 'fail')![1].phase, 'PROVISION_TARGET');
  });

  test('does not compensate a failure during cutover', async () => {
    await reconcileDataIsolation(makeRepository(snapshot(), calls), makeAdapter(calls, 'activate'), payload);
    assert.ok(!calls.some(([k]) => k === 'adapter.compensate'));
    assert.equal(calls.find(([k]) => k === 'fail')![1].phase, 'CUTOVER');
  });

  test('never persists raw errors that may carry credentials', async () => {
    const leaky = new Error('connect failed postgresql://admin:hunter2@db:5432/x');
    await reconcileDataIsolation(makeRepository(snapshot(), calls), makeAdapter(calls, 'copyData', leaky), payload);

    const persisted = JSON.stringify(calls.filter(([k]) => k === 'fail' || k === 'audit'));
    assert.ok(!persisted.includes('hunter2'));
    assert.equal(calls.find(([k]) => k === 'fail')![1].code, 'ISOLATION_UNEXPECTED');
  });

  test('redacts connection strings inside IsolationError messages', async () => {
    const err = new IsolationError('ISOLATION_COPY_FAILED' as any, 'failed on postgresql://u:p@h/db');
    const result = await reconcileDataIsolation(makeRepository(snapshot(), calls), makeAdapter(calls, 'copyData', err), payload);
    assert.ok(!result.message!.includes('u:p@h'));
    assert.match(result.message!, /\[REDACTED\]/);
  });

  test('builds a source context from the active isolation', async () => {
    let captured: any;
    const adapter = makeAdapter(calls);
    adapter.prepareTarget = async (ctx: any) => {
      captured = ctx;
      return { mode: 'DATABASE', resourceIds: {} };
    };
    await reconcileDataIsolation(makeRepository(snapshot(), calls), adapter, { ...payload, desiredMode: 'DATABASE' });

    assert.equal(captured.sourceMode, 'SHARED');
    assert.equal(captured.targetMode, 'DATABASE');
    assert.deepEqual(captured.source, { mode: 'SHARED', database: 'organator', schema: 'public', role: '', resourceIds: {} });
    assert.deepEqual(captured.sourceConnection, { id: 'ref-1', mode: 'SHARED' });
  });

  test('has no source for a first-time provisioning', async () => {
    let captured: any;
    const adapter = makeAdapter(calls);
    adapter.prepareTarget = async (ctx: any) => {
      captured = ctx;
      return { mode: 'SHARED', resourceIds: {} };
    };
    await reconcileDataIsolation(
      makeRepository(snapshot({ activeIsolation: null, encryptedConnection: null }), calls),
      adapter,
      payload,
    );
    assert.equal(captured.source, null);
    assert.equal(captured.sourceConnection, null);
  });
});

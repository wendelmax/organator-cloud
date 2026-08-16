import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeIsolationError } from './sanitize.js';
import { IsolationError } from './identifiers.js';

test('redacts connection strings, passwords and tokens', () => {
  const safe = sanitizeIsolationError(
    new Error('postgresql://admin:secret@db/x password=secret token=abc'),
  );
  assert.equal(safe.code, 'ISOLATION_UNEXPECTED');
  assert.equal(safe.message.includes('secret'), false);
  assert.equal(safe.message.includes('abc'), false);
});

test('preserves IsolationError code and redacts secrets from message', () => {
  const safe = sanitizeIsolationError(
    new IsolationError('ISOLATION_VALIDATION_FAILED', 'Checksum mismatch for table records'),
  );
  assert.equal(safe.code, 'ISOLATION_VALIDATION_FAILED');
  assert.equal(safe.message, 'Checksum mismatch for table records');
});

test('redacts secrets in IsolationError messages too', () => {
  const safe = sanitizeIsolationError(
    new IsolationError('ISOLATION_CONNECTION_FAILED', 'Failed to connect to postgresql://admin:pass@db/x'),
  );
  assert.equal(safe.code, 'ISOLATION_CONNECTION_FAILED');
  assert.equal(safe.message.includes('admin'), false);
  assert.equal(safe.message.includes('pass'), false);
});

test('returns generic message for non-IsolationError', () => {
  const safe = sanitizeIsolationError(new TypeError('cannot read property'));
  assert.equal(safe.code, 'ISOLATION_UNEXPECTED');
  assert.equal(safe.message, 'Unexpected data isolation failure');
});

test('handles null/undefined errors', () => {
  const safe = sanitizeIsolationError(null);
  assert.equal(safe.code, 'ISOLATION_UNEXPECTED');
  assert.equal(safe.message, 'Unexpected data isolation failure');
});

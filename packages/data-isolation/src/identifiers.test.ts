import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTenantIdentifier } from './identifiers.js';

test('creates a stable safe identifier from a UUID', () => {
  assert.equal(
    makeTenantIdentifier('Schema', '0f5f1bc2-34c5-4678-9abc-def012345678'),
    'org_schema_0f5f1bc234c5',
  );
});

test('is case-insensitive for prefix', () => {
  assert.equal(
    makeTenantIdentifier('ROLE', '0f5f1bc2-34c5-4678-9abc-def012345678'),
    'org_role_0f5f1bc234c5',
  );
});

test('creates a stable identifier for db prefix', () => {
  assert.equal(
    makeTenantIdentifier('db', '0f5f1bc2-34c5-4678-9abc-def012345678'),
    'org_db_0f5f1bc234c5',
  );
});

test('hashes non-UUID tenant IDs with SHA-256', () => {
  const result = makeTenantIdentifier('role', 'tenant-1');
  assert.match(result, /^org_role_[a-f0-9]{12}$/);
  // Same input should produce same output (stable)
  assert.equal(result, makeTenantIdentifier('role', 'tenant-1'));
});

test('rejects unsupported prefixes', () => {
  assert.throws(() => makeTenantIdentifier('schema;drop', 'tenant-1'), /prefix/i);
});

test('rejects empty prefix', () => {
  assert.throws(() => makeTenantIdentifier('', 'tenant-1'), /prefix/i);
});

test('stays under PostgreSQL 63-byte identifier limit', () => {
  const id = makeTenantIdentifier('schema', '0f5f1bc2-34c5-4678-9abc-def012345678');
  assert.ok(Buffer.byteLength(id) <= 63);
});

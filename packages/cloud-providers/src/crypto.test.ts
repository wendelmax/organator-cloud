import test, { describe, afterEach, after } from 'node:test';
import Tasklets from '@wendelmax/tasklets';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, encryptSecretAsync, decryptSecretAsync } from './crypto.js';

const originalEnv = { ...process.env };

describe('crypto (AES-256-GCM)', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('round-trips unicode text', () => {
    const plain = 'sk_live_çãõ-🔐-123';
    const enc = encryptSecret(plain);
    assert.notEqual(enc, plain);
    assert.match(enc, /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    assert.equal(decryptSecret(enc), plain);
  });

  test('uses a random IV so the same input never produces the same ciphertext', () => {
    assert.notEqual(encryptSecret('same'), encryptSecret('same'));
  });

  test('passes empty values through untouched', () => {
    assert.equal(encryptSecret(''), '');
    assert.equal(decryptSecret(''), '');
  });

  test('returns legacy plaintext values as-is (not in iv:tag:data format)', () => {
    assert.equal(decryptSecret('plain-token'), 'plain-token');
    assert.equal(decryptSecret('a:b:c'), 'a:b:c');
  });

  test('detects tampering via the GCM auth tag', () => {
    const [iv, tag, data] = encryptSecret('secret').split(':');
    const flipped = (data[0] === '0' ? '1' : '0') + data.slice(1);
    assert.throws(() => decryptSecret(`${iv}:${tag}:${flipped}`), /Failed to decrypt secret/);
  });

  test('cannot be decrypted with a different key', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    const enc = encryptSecret('secret');
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    assert.throws(() => decryptSecret(enc), /Failed to decrypt secret/);
  });

  test('accepts non-hex dev keys by padding/truncating to 32 bytes', () => {
    process.env.ENCRYPTION_KEY = 'short-dev-key';
    assert.equal(decryptSecret(encryptSecret('x')), 'x');
  });

  describe('production key policy', () => {
    test('fails hard without ENCRYPTION_KEY', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ENCRYPTION_KEY;
      assert.throws(() => encryptSecret('x'), /ENCRYPTION_KEY must be 64 hexadecimal/);
    });

    test('fails hard with a non-hex or wrong-length key', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENCRYPTION_KEY = 'z'.repeat(64);
      assert.throws(() => encryptSecret('x'), /CRITICAL SECURITY FATAL/);
      process.env.ENCRYPTION_KEY = 'a'.repeat(63);
      assert.throws(() => encryptSecret('x'), /CRITICAL SECURITY FATAL/);
    });

    test('works with a valid 64-hex key', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENCRYPTION_KEY = 'f'.repeat(64);
      assert.equal(decryptSecret(encryptSecret('prod')), 'prod');
    });
  });

  describe('async (worker thread) variants', () => {
    after(() => Tasklets.shutdown());

    test('are interoperable with the sync functions', async () => {
      const encAsync = await encryptSecretAsync('async-secret');
      assert.equal(decryptSecret(encAsync), 'async-secret');
      assert.equal(await decryptSecretAsync(encryptSecret('sync-secret')), 'sync-secret');
    });

    test('pass through empty and legacy values', async () => {
      assert.equal(await encryptSecretAsync(''), '');
      assert.equal(await decryptSecretAsync('legacy'), 'legacy');
    });
  });
});

import test, { describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { encryptSecret } from './crypto.js';
import { maskSecret, maskProviderData, testProviderConnection, SECRET_FIELDS } from './providers.js';

describe('maskSecret', () => {
  test('never exposes the secret body', () => {
    assert.equal(maskSecret(null), null);
    assert.equal(maskSecret(''), null);
    assert.equal(maskSecret('sk_live_abcdef123'), 'sk-****');
    assert.equal(maskSecret('-----BEGIN RSA PRIVATE KEY-----\nMIIE...'), '-----BEGIN [PRIVATE KEY] ****');
    assert.equal(maskSecret('AKIAIOSFODNN7EXAMPLE'), 'AKIA-****');
    assert.equal(maskSecret('short'), '****');
  });
});

describe('maskProviderData', () => {
  test('derives the mask from the field name, never from the (encrypted) value', () => {
    const data = {
      apiToken: encryptSecret('sk_real'),
      accessKeyId: encryptSecret('AKIAREAL'),
      secretAccessKey: encryptSecret('super-secret'),
      privateKey: encryptSecret('-----BEGIN OPENSSH PRIVATE KEY-----'),
    };
    const masked = maskProviderData(data);
    assert.deepEqual(masked, {
      apiToken: 'sk-****',
      accessKeyId: 'AKIA-****',
      secretAccessKey: '****',
      privateKey: '-----BEGIN [PRIVATE KEY] ****',
    });
    for (const value of Object.values(masked)) {
      assert.ok(!Object.values(data).includes(value));
    }
  });

  test('handles empty input', () => {
    assert.deepEqual(maskProviderData(undefined as any), {});
  });
});

describe('testProviderConnection', () => {
  afterEach(() => mock.restoreAll());

  test('declares the required secret fields per provider', () => {
    assert.deepEqual(SECRET_FIELDS, {
      AWS: ['accessKeyId', 'secretAccessKey'],
      VERCEL: ['apiToken'],
      VPS: ['privateKey'],
    });
  });

  for (const [type, secrets] of [
    ['AWS', { accessKeyId: 'mock-access-key', secretAccessKey: 'mock-secret-key' }],
    ['VERCEL', { apiToken: encryptSecret('mock-token') }],
    ['VPS', { privateKey: 'mock-key' }],
  ] as const) {
    test(`simulates success for ${type} demo credentials without network calls`, async () => {
      const get = mock.method(axios, 'get');
      const result = await testProviderConnection(type, secrets as any);
      assert.deepEqual({ ok: result.ok, mock: result.mock }, { ok: true, mock: true });
      assert.equal(get.mock.callCount(), 0);
    });
  }

  test('treats missing secrets as mock', async () => {
    const result = await testProviderConnection('AWS', {});
    assert.equal(result.mock, true);
  });

  test('authenticates Vercel with the decrypted token', async () => {
    const get = mock.method(axios, 'get', async () => ({ data: { user: { username: 'acme' } } }));
    const result = await testProviderConnection('VERCEL', { apiToken: encryptSecret('real-token') }, {}, 1234);

    assert.deepEqual(result, { ok: true, message: 'Vercel autenticado: acme' });
    const [url, opts] = get.mock.calls[0].arguments as any[];
    assert.equal(url, 'https://api.vercel.com/v2/user');
    assert.equal(opts.headers.Authorization, 'Bearer real-token');
    assert.equal(opts.timeout, 1234);
  });

  test('never throws: provider errors become { ok: false }', async () => {
    mock.method(axios, 'get', async () => {
      throw new Error('Request failed with status code 403');
    });
    const result = await testProviderConnection('VERCEL', { apiToken: 'real-token' });
    assert.deepEqual(result, { ok: false, message: 'Request failed with status code 403' });
  });

  test('reports decryption failures as a failed connection', async () => {
    const [iv, tag] = encryptSecret('x').split(':');
    const result = await testProviderConnection('VERCEL', { apiToken: `${iv}:${tag}:deadbeef` });
    assert.equal(result.ok, false);
    assert.match(result.message, /Failed to decrypt/);
  });
});

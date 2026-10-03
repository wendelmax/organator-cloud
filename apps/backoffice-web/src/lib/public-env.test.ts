import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApiUrl, publicApiUrl, publicEnvScript, publicSsoEnabled, readPublicEnv, serverApiUrl } from './public-env';

describe('public runtime env', () => {
  afterEach(() => {
    delete (globalThis as any).window;
  });

  test('normalizes trailing slashes and the /v1 suffix', () => {
    assert.equal(normalizeApiUrl('https://api.acme.com/'), 'https://api.acme.com');
    assert.equal(normalizeApiUrl('https://api.acme.com/v1'), 'https://api.acme.com');
    assert.equal(normalizeApiUrl(' https://api.acme.com/v1/ '), 'https://api.acme.com');
  });

  test('prefers the runtime PUBLIC_API_URL over the build-time NEXT_PUBLIC_API_URL', () => {
    assert.equal(
      readPublicEnv({ PUBLIC_API_URL: 'https://runtime.acme.com', NEXT_PUBLIC_API_URL: 'https://build.acme.com' } as any).apiUrl,
      'https://runtime.acme.com',
    );
    assert.equal(readPublicEnv({ NEXT_PUBLIC_API_URL: 'https://build.acme.com/v1' } as any).apiUrl, 'https://build.acme.com');
    assert.equal(readPublicEnv({} as any).apiUrl, 'http://localhost:3001');
  });

  test('server code prefers the internal API_URL', () => {
    assert.equal(
      serverApiUrl({ API_URL: 'http://api.internal:3001/', PUBLIC_API_URL: 'https://api.acme.com' } as any),
      'http://api.internal:3001',
    );
    assert.equal(serverApiUrl({ PUBLIC_API_URL: 'https://api.acme.com' } as any), 'https://api.acme.com');
  });

  test('the browser reads the value injected by the root layout', () => {
    (globalThis as any).window = { __ORGANATOR_ENV__: { apiUrl: 'https://injected.acme.com/v1' } };
    assert.equal(publicApiUrl(), 'https://injected.acme.com');
  });

  test('SSO is enabled only when the VoidAuth client is fully configured', () => {
    assert.equal(readPublicEnv({} as any).ssoEnabled, false);
    assert.equal(readPublicEnv({ VOIDAUTH_CLIENT_ID: 'organator' } as any).ssoEnabled, false);
    assert.equal(readPublicEnv({ VOIDAUTH_CLIENT_ID: 'organator', VOIDAUTH_CLIENT_SECRET: 's' } as any).ssoEnabled, true);

    (globalThis as any).window = { __ORGANATOR_ENV__: { apiUrl: 'x', ssoEnabled: true } };
    assert.equal(publicSsoEnabled(), true);
    (globalThis as any).window = { __ORGANATOR_ENV__: { apiUrl: 'x' } };
    assert.equal(publicSsoEnabled(), false);
  });

  test('the injected script cannot break out of the <script> tag', () => {
    const script = publicEnvScript({ apiUrl: 'https://x.com/</script><script>alert(1)</script>', ssoEnabled: false, termsUrl: '', privacyUrl: '' });
    assert.ok(!script.includes('</script>'));
    const sandbox: any = {};
    new Function('window', script)(sandbox);
    assert.equal(sandbox.__ORGANATOR_ENV__.apiUrl, 'https://x.com/</script><script>alert(1)</script>');
  });
});

describe('legal document links', () => {
  test('come from TERMS_URL / PRIVACY_POLICY_URL and default to no link', () => {
    assert.deepEqual(
      [readPublicEnv({ TERMS_URL: ' https://acme.com/termos ' } as any).termsUrl, readPublicEnv({} as any).privacyUrl],
      ['https://acme.com/termos', ''],
    );
  });
});

import test, { describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { authOptions } from './auth';

const credentials = authOptions.providers.find((p: any) => p.id === 'credentials') as any;
// next-auth guarda a implementação do usuário em `options.authorize`.
const authorize = (creds: Record<string, string>) => credentials.options.authorize(creds, {} as any);

function mockFetch(status: number, body: unknown) {
  return mock.method(globalThis, 'fetch', async () => ({ ok: status < 400, status, json: async () => body }) as any);
}

describe('authOptions — credentials login', () => {
  afterEach(() => mock.restoreAll());

  test('posts the credentials to the control-plane API', async () => {
    const fetchMock = mockFetch(200, {
      access_token: 'jwt-1',
      user: { id: 'u1', email: 'o@acme.com', role: 'OWNER', tenantId: 't1', mustChangePassword: true, mfaEnabled: false },
    });

    const user = await authorize({ email: 'o@acme.com', password: 'pw' });

    const [url, init] = fetchMock.mock.calls[0].arguments as any[];
    assert.match(url, /\/v1\/auth\/login$/);
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { email: 'o@acme.com', password: 'pw' });
    assert.deepEqual(user, {
      id: 'u1',
      name: 'o@acme.com',
      email: 'o@acme.com',
      role: 'OWNER',
      tenantId: 't1',
      mustChangePassword: true,
      mfaEnabled: false,
      token: 'jwt-1',
    });
  });

  test('rejects invalid credentials', async () => {
    mockFetch(401, { message: 'Invalid credentials' });
    assert.equal(await authorize({ email: 'x', password: 'y' }), null);
  });

  test('does not sign in while an MFA challenge is pending (no access token yet)', async () => {
    mockFetch(200, { mfa_required: true, challenge_token: 'c', user: { id: 'u1' } });
    assert.equal(await authorize({ email: 'x', password: 'y' }), null);
  });

  test('returns null when the API is unreachable', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    assert.equal(await authorize({ email: 'x', password: 'y' }), null);
  });

  test('uses the custom login page', () => {
    assert.equal(authOptions.pages?.signIn, '/login');
  });
});

describe('authOptions — callbacks', () => {
  const jwt = authOptions.callbacks!.jwt as any;
  const session = authOptions.callbacks!.session as any;

  test('copies the API identity into the NextAuth token on sign in', async () => {
    const token = await jwt({
      token: { sub: 'u1' },
      user: { role: 'OWNER', tenantId: 't1', mustChangePassword: false, mfaEnabled: true, token: 'jwt-1' },
    });
    assert.deepEqual(token, { sub: 'u1', role: 'OWNER', tenantId: 't1', mustChangePassword: false, mfaEnabled: true, accessToken: 'jwt-1' });
  });

  test('replaces the access token after a tenant switch', async () => {
    const token = await jwt({
      token: { accessToken: 'old', tenantId: 't1', role: 'OWNER' },
      session: { accessToken: 'new', tenantId: 't2', role: 'MEMBER' },
    });
    assert.deepEqual(token, { accessToken: 'new', tenantId: 't2', role: 'MEMBER' });
  });

  test('keeps the token untouched on regular requests', async () => {
    const original = { accessToken: 'a', role: 'OWNER' };
    assert.deepEqual(await jwt({ token: { ...original } }), original);
  });

  test('exposes role, tenant and access token on the session', async () => {
    const result = await session({
      session: { user: { email: 'o@acme.com' } },
      token: { role: 'OWNER', tenantId: 't1', mustChangePassword: true, accessToken: 'jwt-1' },
    });
    assert.deepEqual(result, {
      user: { email: 'o@acme.com', role: 'OWNER', tenantId: 't1', mustChangePassword: true },
      accessToken: 'jwt-1',
    });
  });
});

describe('authOptions — VoidAuth SSO', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.VOIDAUTH_CLIENT_ID = 'organator';
    process.env.VOIDAUTH_CLIENT_SECRET = 'secret';
    process.env.VOIDAUTH_URL = 'https://auth.acme.com';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // O provider é decidido no carregamento do módulo; recarrega com o env ajustado.
  const loadFresh = () => {
    const load = createRequire(__filename);
    delete load.cache[load.resolve('./auth')];
    return load('./auth').authOptions as typeof authOptions;
  };

  test('is disabled without OIDC client credentials', () => {
    delete process.env.VOIDAUTH_CLIENT_SECRET;
    assert.equal(loadFresh().providers.some((p: any) => p.id === 'voidauth'), false);
  });

  test('uses discovery, PKCE + state and maps the OIDC profile', () => {
    const sso = loadFresh().providers.find((p: any) => p.id === 'voidauth') as any;
    assert.ok(sso);
    assert.equal(sso.wellKnown, 'https://auth.acme.com/oidc/.well-known/openid-configuration');
    assert.deepEqual(sso.checks, ['pkce', 'state']);
    assert.equal(sso.idToken, true);
    assert.deepEqual(sso.profile({ sub: 'ext-1', preferred_username: 'ana', email: 'ana@acme.com', picture: 'p.png' }), {
      id: 'ext-1',
      name: 'ana',
      email: 'ana@acme.com',
      image: 'p.png',
      token: '',
    });
  });
});

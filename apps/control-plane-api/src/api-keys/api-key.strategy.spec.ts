import { ApiKeyStrategy } from './api-key.strategy';

describe('ApiKeyStrategy', () => {
  let apiKeys: any;
  let strategy: any;

  const run = (authorization?: string) =>
    new Promise<{ kind: string; value?: any }>((resolve) => {
      strategy.fail = (status: number) => resolve({ kind: 'fail', value: status });
      strategy.success = (user: any) => resolve({ kind: 'success', value: user });
      strategy.error = (err: Error) => resolve({ kind: 'error', value: err });
      strategy.authenticate({ headers: authorization ? { authorization } : {} });
    });

  beforeEach(() => {
    apiKeys = { validate: jest.fn() };
    strategy = new ApiKeyStrategy(apiKeys);
  });

  it.each([undefined, 'Basic abc', 'Bearer eyJhbGciOi.jwt.token'])(
    'fails silently (401) for non API-key credentials: %s',
    async (header) => {
      await expect(run(header)).resolves.toEqual({ kind: 'fail', value: 401 });
      expect(apiKeys.validate).not.toHaveBeenCalled();
    },
  );

  it('fails for unknown/revoked keys', async () => {
    apiKeys.validate.mockResolvedValue(null);
    await expect(run('Bearer sk_live_nope')).resolves.toEqual({ kind: 'fail', value: 401 });
    expect(apiKeys.validate).toHaveBeenCalledWith('sk_live_nope');
  });

  it('builds a synthetic automation principal from a valid key', async () => {
    apiKeys.validate.mockResolvedValue({ id: 'k1', name: 'ci', tenantId: 't1', scopes: ['services:read'] });
    await expect(run('Bearer sk_live_ok')).resolves.toEqual({
      kind: 'success',
      value: {
        userId: 'k1',
        apiKeyId: 'k1',
        apiKeyAuth: true,
        name: 'ci',
        role: 'API_KEY',
        tenantId: 't1',
        keyScopes: ['services:read'],
      },
    });
  });

  it('maps platform keys to no tenant and empty scopes', async () => {
    apiKeys.validate.mockResolvedValue({ id: 'k2', name: 'ops', tenantId: null, scopes: null });
    const { value } = await run('Bearer sk_platform');
    expect(value).toMatchObject({ tenantId: undefined, keyScopes: [] });
  });

  it('reports lookup errors', async () => {
    apiKeys.validate.mockRejectedValue(new Error('db down'));
    const result = await run('Bearer sk_x');
    expect(result.kind).toBe('error');
    expect(result.value.message).toBe('db down');
  });
});

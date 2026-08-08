import { AuthService } from './auth.service';

describe('AuthService MFA gate', () => {
  it('returns a challenge without a JWT when tenant policy requires MFA', async () => {
    const mfa = { createChallenge: jest.fn().mockResolvedValue({ challenge_token: 'opaque', expires_at: 'later' }) };
    const policy = { requiresMfa: jest.fn().mockResolvedValue(true) };
    const service = new AuthService({} as never, { sign: jest.fn() } as never, mfa as never, policy as never);
    const result = await service.login({ id: 'u1', email: 'u@example.com', role: 'OWNER', tenantId: 't1' });
    expect(result).toMatchObject({ mfa_required: true, challenge_token: 'opaque' });
    expect(result).not.toHaveProperty('access_token');
  });
});

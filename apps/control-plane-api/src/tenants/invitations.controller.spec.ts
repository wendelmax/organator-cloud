import { InvitationsController } from './invitations.controller';

describe('InvitationsController', () => {
  const invitations = {
    list: jest.fn(),
    create: jest.fn(),
    revoke: jest.fn(),
    resend: jest.fn(),
    accept: jest.fn(),
  };
  const controller = new InvitationsController(invitations as any);

  beforeEach(() => jest.clearAllMocks());

  it('creates an invitation in the authenticated tenant scope', async () => {
    invitations.create.mockResolvedValue({ id: 'invite-1' });

    await controller.create(
      { user: { tenantId: 'tenant-1', userId: 'owner-1' } },
      { email: 'dev@example.com', role: 'MEMBER' },
    );

    expect(invitations.create).toHaveBeenCalledWith(
      'tenant-1',
      'dev@example.com',
      'MEMBER',
      'owner-1',
    );
  });

  it('scopes revocation to the authenticated tenant', async () => {
    invitations.revoke.mockResolvedValue({ revoked: true });

    await controller.revoke(
      { user: { tenantId: 'tenant-1', userId: 'admin-1' } },
      'invite-1',
    );

    expect(invitations.revoke).toHaveBeenCalledWith(
      'tenant-1',
      'invite-1',
      'admin-1',
    );
  });

  it('accepts a one-time token without requiring an authenticated session', async () => {
    invitations.accept.mockResolvedValue({ userId: 'user-1' });

    await controller.accept({ token: 'opaque-token', name: 'Dev' });

    expect(invitations.accept).toHaveBeenCalledWith('opaque-token', 'Dev');
  });
});

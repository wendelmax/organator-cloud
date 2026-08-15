import { ConflictException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';

describe('InvitationsService lifecycle', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
    },
    tenantMembership: {
      findUnique: jest.fn(),
    },
    tenantInvitation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const service = new InvitationsService(prisma, audit as any);

  beforeEach(() => jest.clearAllMocks());

  it('allows inviting an existing user into a second tenant', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'dev@example.com',
    });
    prisma.tenantMembership.findUnique.mockResolvedValue(null);
    prisma.tenantInvitation.findFirst.mockResolvedValue(null);
    prisma.tenantInvitation.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'invite-1', ...data }),
    );

    const result = await service.create(
      'tenant-2',
      'DEV@example.com',
      'MEMBER',
      'owner-2',
    );

    expect(result).toMatchObject({
      id: 'invite-1',
      email: 'dev@example.com',
      role: 'MEMBER',
    });
    expect(prisma.tenantMembership.findUnique).toHaveBeenCalledWith({
      where: { tenantId_userId: { tenantId: 'tenant-2', userId: 'user-1' } },
    });
  });

  it('rejects inviting an existing member of the tenant', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'dev@example.com',
    });
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: 'membership-1',
    });

    await expect(
      service.create('tenant-1', 'dev@example.com', 'MEMBER', 'owner-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('revokes only a pending invitation from the actor tenant', async () => {
    prisma.tenantInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      tenantId: 'tenant-1',
      email: 'dev@example.com',
      acceptedAt: null,
      revokedAt: null,
    });
    prisma.tenantInvitation.update.mockResolvedValue({
      id: 'invite-1',
      revokedAt: new Date(),
    });

    await service.revoke('tenant-1', 'invite-1', 'owner-1');

    expect(prisma.tenantInvitation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'invite-1',
        tenantId: 'tenant-1',
        acceptedAt: null,
        revokedAt: null,
      },
    });
    expect(prisma.tenantInvitation.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.invitation_revoked',
        actorId: 'owner-1',
      }),
    );
  });

  it('rejects an accepted, revoked, expired, or cross-tenant invitation', async () => {
    prisma.tenantInvitation.findFirst.mockResolvedValue(null);
    await expect(
      service.revoke('tenant-1', 'invite-2', 'owner-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rotates token and expiry when resending a pending invitation', async () => {
    prisma.tenantInvitation.findFirst.mockResolvedValue({
      id: 'invite-1',
      tenantId: 'tenant-1',
      email: 'dev@example.com',
      acceptedAt: null,
      revokedAt: null,
    });
    prisma.tenantInvitation.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'invite-1', email: 'dev@example.com', ...data }),
    );

    const result = await service.resend('tenant-1', 'invite-1', 'owner-1');

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.tenantInvitation.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: {
        tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        expiresAt: expect.any(Date),
        sentAt: expect.any(Date),
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.invitation_resent' }),
    );
  });

  it('accepts an invitation for an existing user by adding only the tenant membership', async () => {
    const invitation = {
      id: 'invite-1',
      tenantId: 'tenant-2',
      email: 'dev@example.com',
      role: 'MEMBER',
      acceptedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    prisma.tenantInvitation.findUnique.mockResolvedValue(invitation);
    const tx: any = {
      tenantInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', email: 'dev@example.com' }),
        create: jest.fn(),
      },
      tenantMembership: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    const result = await service.accept('raw-token');

    expect(result).toEqual({
      userId: 'user-1',
      email: 'dev@example.com',
      temporaryPassword: null,
      mustChangePassword: false,
    });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.tenantMembership.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-2',
        userId: 'user-1',
        role: 'MEMBER',
        status: 'active',
      },
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';

describe('InvitationsService lifecycle', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    tenantInvitation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new InvitationsService(prisma, audit as any);

  beforeEach(() => jest.clearAllMocks());

  it('revokes only a pending invitation from the actor tenant', async () => {
    prisma.tenantInvitation.findFirst.mockResolvedValue({ id: 'invite-1', tenantId: 'tenant-1', email: 'dev@example.com', acceptedAt: null, revokedAt: null });
    prisma.tenantInvitation.update.mockResolvedValue({ id: 'invite-1', revokedAt: new Date() });

    await service.revoke('tenant-1', 'invite-1', 'owner-1');

    expect(prisma.tenantInvitation.findFirst).toHaveBeenCalledWith({ where: { id: 'invite-1', tenantId: 'tenant-1', acceptedAt: null, revokedAt: null } });
    expect(prisma.tenantInvitation.update).toHaveBeenCalledWith({ where: { id: 'invite-1' }, data: { revokedAt: expect.any(Date) } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.invitation_revoked', actorId: 'owner-1' }));
  });

  it('rejects an accepted, revoked, expired, or cross-tenant invitation', async () => {
    prisma.tenantInvitation.findFirst.mockResolvedValue(null);
    await expect(service.revoke('tenant-1', 'invite-2', 'owner-1')).rejects.toThrow(NotFoundException);
  });

  it('rotates token and expiry when resending a pending invitation', async () => {
    prisma.tenantInvitation.findFirst.mockResolvedValue({ id: 'invite-1', tenantId: 'tenant-1', email: 'dev@example.com', acceptedAt: null, revokedAt: null });
    prisma.tenantInvitation.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'invite-1', email: 'dev@example.com', ...data }));

    const result = await service.resend('tenant-1', 'invite-1', 'owner-1');

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.tenantInvitation.update).toHaveBeenCalledWith({ where: { id: 'invite-1' }, data: { tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), expiresAt: expect.any(Date), sentAt: expect.any(Date) } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.invitation_resent' }));
  });
});
